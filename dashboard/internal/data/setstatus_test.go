package data

import (
	"errors"
	"os/exec"
	"reflect"
	"strings"
	"testing"

	"github.com/santifer/jobber/dashboard/internal/model"
)

// fake builds a runner that records its call and returns canned output.
func fake(stdout, stderr string, err error, seen *[]string, seenDir *string) StatusRunner {
	return func(dir string, args []string) ([]byte, []byte, error) {
		if seen != nil {
			*seen = append([]string(nil), args...)
		}
		if seenDir != nil {
			*seenDir = dir
		}
		return []byte(stdout), []byte(stderr), err
	}
}

var sampleApp = model.CareerApplication{Number: 12, Company: "Acme", Role: "Platform Engineer", ReportNumber: "012"}

func TestSetStatusSuccessParsesResultAndBuildsArgs(t *testing.T) {
	var args []string
	var dir string
	out := `{"changed":true,"num":12,"company":"Acme","role":"Platform Engineer","oldStatus":"Evaluated","newStatus":"Applied","warnings":["w1"]}`
	res, err := SetStatusWith(fake(out, "", nil, &args, &dir), "/jobber", sampleApp, "Applied", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res.Changed || res.Num != 12 || res.OldStatus != "Evaluated" || res.NewStatus != "Applied" || !reflect.DeepEqual(res.Warnings, []string{"w1"}) {
		t.Errorf("result = %+v", res)
	}
	want := []string{"set-status.mjs", "12", "Applied", "--json", "--role", "Platform Engineer"}
	if !reflect.DeepEqual(args, want) || dir != "/jobber" {
		t.Errorf("args = %v dir = %q, want %v in /jobber", args, dir, want)
	}
	for _, a := range args {
		if a == "--force" {
			t.Error("an ordinary write must never pass --force")
		}
	}
}

func TestSetStatusNoteAndSelectorFallbacks(t *testing.T) {
	var args []string
	ok := `{"changed":true,"num":1}`
	// note is passed as --note
	if _, err := SetStatusWith(fake(ok, "", nil, &args, nil), ".", sampleApp, "Discarded", "DISCARD: salary_too_low"); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(args[len(args)-2:], []string{"--note", "DISCARD: salary_too_low"}) {
		t.Errorf("note args = %v", args)
	}
	// no tracker number: the report number is the selector, leading zeros dropped
	app := model.CareerApplication{ReportNumber: "007", Company: "Beta", Role: "SRE"}
	_, _ = SetStatusWith(fake(ok, "", nil, &args, nil), ".", app, "Applied", "")
	if args[1] != "7" {
		t.Errorf("report-number selector = %q, want 7", args[1])
	}
	// neither: the company name
	app = model.CareerApplication{Company: "Gamma Co", Role: "--weird"}
	_, _ = SetStatusWith(fake(ok, "", nil, &args, nil), ".", app, "Applied", "")
	if args[1] != "Gamma Co" {
		t.Errorf("company selector = %q", args[1])
	}
	for _, a := range args {
		if a == "--role" {
			t.Errorf("a role starting with -- must not be sent as a --role value: %v", args)
		}
	}
}

func TestSetStatusRefusalKeepsScriptText(t *testing.T) {
	msg := "Illegal status transition: Rejected → Interview. Illegal transition Rejected -> Interview: Rejected is a terminal state of application-status. Re-run with --force to override."
	stdout := `{"error":"` + msg + `","code":"illegal-transition","terminal":true}`
	_, err := SetStatusWith(fake(stdout, "❌ "+msg, &exec.ExitError{}, nil, nil), ".", sampleApp, "Interview", "")
	var se *SetStatusError
	if !errors.As(err, &se) {
		t.Fatalf("want *SetStatusError, got %T %v", err, err)
	}
	if se.Message != msg || se.Error() != msg || se.Code != "illegal-transition" || !se.IsTerminalRefusal() {
		t.Errorf("error = %+v", se)
	}
	// control: another refusal code is not a terminal refusal
	_, err = SetStatusWith(fake(`{"error":"No tracker row with #12","code":"not-found"}`, "", &exec.ExitError{}, nil, nil), ".", sampleApp, "Applied", "")
	if !errors.As(err, &se) || se.IsTerminalRefusal() || se.Code != "not-found" || se.Message != "No tracker row with #12" {
		t.Errorf("not-found error = %+v", se)
	}
}

func TestSetStatusNonJSONFailureUsesStderrLastLine(t *testing.T) {
	_, err := SetStatusWith(fake("", "noise\n❌ Cannot write tracker\n", &exec.ExitError{}, nil, nil), ".", sampleApp, "Applied", "")
	var se *SetStatusError
	if !errors.As(err, &se) || se.Message != "Cannot write tracker" || se.Code != "run-failed" {
		t.Errorf("error = %+v", err)
	}
	_, err = SetStatusWith(fake("", "", &exec.ExitError{}, nil, nil), ".", sampleApp, "Applied", "")
	if !errors.As(err, &se) || strings.TrimSpace(se.Message) == "" {
		t.Errorf("silent failure must still carry a message, got %+v", err)
	}
}

func TestSetStatusBadJSON(t *testing.T) {
	for name, out := range map[string]string{"garbage": "not json", "empty": "", "partial": `{"changed":`} {
		res, err := SetStatusWith(fake(out, "", nil, nil, nil), ".", sampleApp, "Applied", "")
		var se *SetStatusError
		if !errors.As(err, &se) || se.Code != "bad-output" {
			t.Errorf("%s: want bad-output error, got res=%+v err=%v", name, res, err)
		}
	}
	// control: valid JSON on exit 0 is success
	if _, err := SetStatusWith(fake(`{"changed":false}`, "", nil, nil, nil), ".", sampleApp, "Applied", ""); err != nil {
		t.Errorf("control: valid JSON must succeed, got %v", err)
	}
}

func TestSetStatusNodeMissing(t *testing.T) {
	missing := &exec.Error{Name: "node", Err: exec.ErrNotFound}
	_, err := SetStatusWith(fake("", "", missing, nil, nil), ".", sampleApp, "Applied", "")
	var se *SetStatusError
	if !errors.As(err, &se) || se.Code != "node-missing" || !errors.Is(err, exec.ErrNotFound) || !strings.Contains(se.Message, "Node.js") {
		t.Errorf("error = %+v", err)
	}
	// control: another start failure is not reported as "node missing"
	_, err = SetStatusWith(fake("", "", errors.New("permission denied"), nil, nil), ".", sampleApp, "Applied", "")
	if !errors.As(err, &se) || se.Code != "run-failed" {
		t.Errorf("error = %+v", err)
	}
}

// The real runner with node absent from PATH must return an error, not panic.
func TestExecRunnerWithoutNodeOnPath(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	_, err := SetStatus(t.TempDir(), sampleApp, "Applied", "")
	var se *SetStatusError
	if !errors.As(err, &se) || se.Code != "node-missing" {
		t.Errorf("want node-missing, got %+v", err)
	}
}

func TestSetStatusForcedAddsForceFlagOnly(t *testing.T) {
	var plain, forced []string
	ok := `{"changed":true,"num":12,"company":"Acme","role":"Platform Engineer","oldStatus":"Rejected","newStatus":"Interview"}`
	if _, err := SetStatusWith(fake(ok, "", nil, &plain, nil), ".", sampleApp, "Interview", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := SetStatusForcedWith(fake(ok, "", nil, &forced, nil), ".", sampleApp, "Interview", "reopened"); err != nil {
		t.Fatal(err)
	}
	for _, a := range plain {
		if a == "--force" {
			t.Errorf("unforced args carry --force: %v", plain)
		}
	}
	want := []string{"set-status.mjs", "12", "Interview", "--json", "--role", "Platform Engineer", "--note", "reopened", "--force"}
	if !reflect.DeepEqual(forced, want) {
		t.Errorf("forced args = %v, want %v", forced, want)
	}
}
