package data

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/santifer/jobber/dashboard/internal/model"
)

// Status writes go through `node set-status.mjs` (STATE-MACHINES-PLAN decision D3): one
// gate (terminal states are refused without --force), one ledger (status-log.tsv), one lock,
// and the same error texts as every other writer. The TUI passes --force only through
// SetStatusForced, after the user confirmed a refused move out of a terminal state.

// statusWriteTimeout bounds one set-status run; the script itself waits up to 60 s for a busy
// tracker lock, so this leaves room for that wait.
const statusWriteTimeout = 90 * time.Second

// StatusRunner runs `node <args...>` with dir as the working directory and returns the raw
// stdout and stderr. A non-nil error is the process error (*exec.ExitError for a non-zero
// exit, exec.ErrNotFound-wrapping when node is missing). It is a field-sized seam so tests
// do not need node.
type StatusRunner func(dir string, args []string) (stdout, stderr []byte, err error)

// statusRunner is the production runner; tests swap it through SetStatusWith.
var statusRunner StatusRunner = execStatusRunner

func execStatusRunner(dir string, args []string) ([]byte, []byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), statusWriteTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", args...)
	cmd.Dir = dir
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		err = fmt.Errorf("timed out after %s: %w", statusWriteTimeout, ctx.Err())
	}
	return out.Bytes(), errb.Bytes(), err
}

// SetStatusResult is the success payload of set-status --json (the fields the TUI uses).
type SetStatusResult struct {
	Changed   bool     `json:"changed"`
	Num       int      `json:"num"`
	Company   string   `json:"company"`
	Role      string   `json:"role"`
	OldStatus string   `json:"oldStatus"`
	NewStatus string   `json:"newStatus"`
	Warnings  []string `json:"warnings"`
}

// SetStatusError is a refused or failed status write. Message is set-status's own text
// (for example the terminal-state refusal with its --force hint) so the UI can show it as is.
type SetStatusError struct {
	Code    string // set-status's machine code ("illegal-transition", "not-found", ...), or one of this package's: "node-missing", "bad-output", "run-failed"
	Message string
	Cause   error
}

func (e *SetStatusError) Error() string { return e.Message }
func (e *SetStatusError) Unwrap() error { return e.Cause }

// IsTerminalRefusal reports whether set-status refused because the row is in a terminal
// state (Hired, Rejected, Discarded) and leaving it needs an explicit override.
func (e *SetStatusError) IsTerminalRefusal() bool { return e.Code == "illegal-transition" }

// setStatusSelector picks the row selector the way set-status resolves rows: the tracker #
// when the app has one, else its report number, else the company name.
func setStatusSelector(app model.CareerApplication) string {
	if app.Number > 0 {
		return strconv.Itoa(app.Number)
	}
	if n, err := strconv.Atoi(strings.TrimSpace(app.ReportNumber)); err == nil && n > 0 {
		return strconv.Itoa(n)
	}
	return app.Company
}

// setStatusArgs builds the argv for node. --role is sent as a wrong-row guard (set-status
// refuses when the row it resolves is not the role the TUI showed); values that start with
// "--" would be read as flags, so they are left out.
func setStatusArgs(app model.CareerApplication, newStatus, note string, force bool) []string {
	args := []string{"set-status.mjs", setStatusSelector(app), newStatus, "--json"}
	if role := strings.TrimSpace(app.Role); role != "" && !strings.HasPrefix(role, "--") {
		args = append(args, "--role", role)
	}
	if note != "" {
		args = append(args, "--note", note)
	}
	if force {
		args = append(args, "--force")
	}
	return args
}

// SetStatus changes an application's status (and optionally appends a note) by running
// set-status.mjs in jobberPath. The error is a *SetStatusError whenever the gate or the
// script refused or failed.
func SetStatus(jobberPath string, app model.CareerApplication, newStatus, note string) (SetStatusResult, error) {
	return SetStatusWith(statusRunner, jobberPath, app, newStatus, note)
}

// SetStatusWith is SetStatus with an injectable runner.
func SetStatusWith(run StatusRunner, jobberPath string, app model.CareerApplication, newStatus, note string) (SetStatusResult, error) {
	return setStatusWith(run, jobberPath, app, newStatus, note, false)
}

// SetStatusForced is SetStatus with --force: it applies a move the gate refused (leaving Hired,
// Rejected or Discarded). Callers must have the user's explicit confirmation first. --force
// also lifts set-status's wrong-row guards, which is why it is only used on the row the
// unforced attempt already resolved.
func SetStatusForced(jobberPath string, app model.CareerApplication, newStatus, note string) (SetStatusResult, error) {
	return setStatusWith(statusRunner, jobberPath, app, newStatus, note, true)
}

// SetStatusForcedWith is SetStatusForced with an injectable runner.
func SetStatusForcedWith(run StatusRunner, jobberPath string, app model.CareerApplication, newStatus, note string) (SetStatusResult, error) {
	return setStatusWith(run, jobberPath, app, newStatus, note, true)
}

func setStatusWith(run StatusRunner, jobberPath string, app model.CareerApplication, newStatus, note string, force bool) (SetStatusResult, error) {
	stdout, stderr, runErr := run(jobberPath, setStatusArgs(app, newStatus, note, force))

	if runErr != nil {
		var exitErr *exec.ExitError
		if !errors.As(runErr, &exitErr) {
			if errors.Is(runErr, exec.ErrNotFound) {
				return SetStatusResult{}, &SetStatusError{Code: "node-missing", Cause: runErr,
					Message: "Node.js was not found on PATH, so the status change was not written. Install Node.js (the same one Jobber's scripts use) and try again."}
			}
			return SetStatusResult{}, &SetStatusError{Code: "run-failed", Cause: runErr,
				Message: "could not run set-status.mjs: " + runErr.Error()}
		}
		// set-status exited non-zero: with --json it prints {"error","code",...} on stdout.
		var failure struct {
			Error string `json:"error"`
			Code  string `json:"code"`
		}
		if json.Unmarshal(bytes.TrimSpace(stdout), &failure) == nil && failure.Error != "" {
			return SetStatusResult{}, &SetStatusError{Code: failure.Code, Message: failure.Error, Cause: runErr}
		}
		msg := lastLine(stderr)
		if msg == "" {
			msg = runErr.Error()
		}
		return SetStatusResult{}, &SetStatusError{Code: "run-failed", Message: msg, Cause: runErr}
	}

	var res SetStatusResult
	if err := json.Unmarshal(bytes.TrimSpace(stdout), &res); err != nil {
		return SetStatusResult{}, &SetStatusError{Code: "bad-output", Cause: err,
			Message: "set-status.mjs printed output the dashboard could not read (" + err.Error() + "); the status may or may not have changed — press r to reload"}
	}
	return res, nil
}

// lastLine returns the last non-empty line of b, with the "❌ " prefix set-status prints dropped.
func lastLine(b []byte) string {
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(lines[i]), "❌")); line != "" {
			return line
		}
	}
	return ""
}
