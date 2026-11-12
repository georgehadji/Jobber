package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/jobber/dashboard/internal/data"
	"github.com/santifer/jobber/dashboard/internal/i18n"
	"github.com/santifer/jobber/dashboard/internal/model"
	"github.com/santifer/jobber/dashboard/internal/theme"
	"github.com/santifer/jobber/dashboard/internal/ui/screens"
)

type viewState int

const (
	viewPipeline viewState = iota
	viewReport
	viewProgress
)

type appModel struct {
	pipeline        screens.PipelineModel
	viewer          screens.ViewerModel
	progress        screens.ProgressModel
	state           viewState
	jobberPath   string
	theme           theme.Theme
	progressMetrics model.ProgressMetrics
}

func (m *appModel) reloadPipelineData() {
	apps := data.ParseApplications(m.jobberPath)
	metrics := data.ComputeMetrics(apps)
	m.progressMetrics = data.ComputeProgressMetrics(apps)
	m.pipeline = m.pipeline.WithReloadedData(apps, metrics)
}

func (m appModel) Init() tea.Cmd {
	return nil
}

// setStatus is the status write (set-status.mjs); a variable so tests can fake it.
var setStatus = data.SetStatus

// statusWrittenMsg is the outcome of one status write.
type statusWrittenMsg struct {
	app        model.CareerApplication
	newStatus  string
	res        data.SetStatusResult
	err        error
	fromViewer bool // the write was requested from the report viewer
}

// writeStatusCmd runs the write off the UI goroutine (set-status can wait on the tracker lock).
func writeStatusCmd(jobberPath string, app model.CareerApplication, newStatus, note string, fromViewer bool) tea.Cmd {
	return func() tea.Msg {
		res, err := setStatus(jobberPath, app, newStatus, note)
		return statusWrittenMsg{app: app, newStatus: newStatus, res: res, err: err, fromViewer: fromViewer}
	}
}

// finishStatusWrite applies the real outcome of a status write: reload from disk, then either
// show why nothing changed, or (success only) update the viewer and start the hired celebration.
func (m appModel) finishStatusWrite(msg statusWrittenMsg) appModel {
	m.reloadPipelineData()
	if msg.err != nil {
		text := "Status not changed: " + msg.err.Error()
		if msg.fromViewer {
			m.viewer.SetFlash(text)
		} else {
			m.pipeline.SetFlash(text)
		}
		return m
	}
	if msg.fromViewer {
		m.viewer.UpdateAppStatus(msg.newStatus)
	}
	// Celebrate only a confirmed change into Hired (a no-op re-select is not a new hire).
	if msg.res.Changed && data.NormalizeStatus(msg.newStatus) == "hired" {
		m.state = viewPipeline
		m.pipeline, _ = m.pipeline.StartHiredFlow(msg.app)
	}
	return m
}

// Update manages global app state and routes incoming messages to active screens.
func (m appModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if keyMsg, ok := msg.(tea.KeyMsg); ok {
		switch keyMsg.String() {
		case "t", "T":
			// Toggle language globally, unless the user is actively typing in a text input field
			if !(m.state == viewPipeline && m.pipeline.IsTextInputActive()) {
				i18n.ToggleLang()
			}
		}
	}

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.pipeline.Resize(msg.Width, msg.Height)
		if m.state == viewReport {
			m.viewer.Resize(msg.Width, msg.Height)
		}
		if m.state == viewProgress {
			m.progress.Resize(msg.Width, msg.Height)
		}
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd

	case screens.PipelineClosedMsg:
		return m, tea.Quit

	case screens.PipelineLoadReportMsg:
		archetype, tldr, remote, comp := data.LoadReportSummary(msg.JobberPath, msg.ReportPath)
		m.pipeline.EnrichReport(msg.ReportPath, archetype, tldr, remote, comp)
		return m, nil

	case screens.PipelineUpdateStatusMsg:
		return m, writeStatusCmd(msg.JobberPath, msg.App, msg.NewStatus, "", false)

	case screens.PipelineUpdateStatusAndNotesMsg:
		// Issue 1380: atomic status + notes write from the discard reason picker.
		return m, writeStatusCmd(msg.JobberPath, msg.App, msg.NewStatus, msg.NotesAppend, false)

	case statusWrittenMsg:
		return m.finishStatusWrite(msg), nil

	case screens.PipelineRefreshMsg:
		m.reloadPipelineData()
		return m, nil

	case screens.PipelineOpenReportMsg:
		m.viewer = screens.NewViewerModel(
			m.theme,
			m.jobberPath,
			msg.Path, msg.Title,
			m.pipeline.Width(), m.pipeline.Height(),
			msg.App,
		)
		m.state = viewReport
		return m, nil

	case screens.ViewerClosedMsg:
		m.state = viewPipeline
		return m, nil

	case screens.ViewerOpenCoverLetterMsg:
		path := msg.Path
		return m, func() tea.Msg {
			if err := openChecked(path); err != nil {
				fmt.Fprintf(os.Stderr, "WARN: could not open cover letter: %v\n", err)
			}
			return nil
		}

	case screens.ViewerUpdateStatusMsg:
		if data.AsksDiscardReason(data.NormalizeStatus(msg.NewStatus)) {
			m.state = viewPipeline
			m.pipeline, _ = m.pipeline.StartDiscardReasonFlow(msg.App, msg.NewStatus)
			m.reloadPipelineData()
			return m, nil
		}
		// Everything else (hired included) is written first; finishStatusWrite updates the
		// viewer, starts the hired celebration, or shows the error, from the real outcome.
		return m, writeStatusCmd(m.jobberPath, msg.App, msg.NewStatus, "", true)

	case screens.PipelineOpenProgressMsg:
		m.progress = screens.NewProgressModel(
			theme.NewTheme("catppuccin-mocha"),
			m.progressMetrics,
			m.pipeline.Width(), m.pipeline.Height(),
		)
		m.state = viewProgress
		return m, nil

	case screens.ProgressClosedMsg:
		m.state = viewPipeline
		return m, nil

	case screens.PipelineOpenURLMsg:
		return m, openCmd(msg.URL)

	case screens.PipelineOpenPDFMsg:
		return m, openCmd(msg.Path)

	case screens.PipelineGeneratePDFMsg:
		return m, runGeneratePDF(msg)

	default:
		if m.state == viewReport {
			vm, cmd := m.viewer.Update(msg)
			m.viewer = vm
			return m, cmd
		}
		if m.state == viewProgress {
			pg, cmd := m.progress.Update(msg)
			m.progress = pg
			return m, cmd
		}
		pm, cmd := m.pipeline.Update(msg)
		m.pipeline = pm
		return m, cmd
	}
}

// openCmd wraps openChecked (the guard plus the OS-specific opener) as a tea.Cmd. Shared by the
// job-URL (`o`) and CV-PDF (`d`) actions.
func openCmd(target string) tea.Cmd {
	return func() tea.Msg {
		if err := openChecked(target); err != nil {
			fmt.Fprintf(os.Stderr, "WARN: failed to open %q: %v\n", target, err)
		}
		return nil
	}
}

// runGeneratePDF shells out to node generate-pdf.mjs in the Jobber root,
// opens the resulting PDF on success, and reports the outcome back to the
// pipeline screen as a PipelinePDFGeneratedMsg. Runs in a tea.Cmd goroutine,
// so the UI stays responsive while Chromium renders.
func runGeneratePDF(msg screens.PipelineGeneratePDFMsg) tea.Cmd {
	return func() tea.Msg {
		args := []string{"generate-pdf.mjs", msg.HTMLPath, msg.PDFPath}
		if msg.Format != "" {
			args = append(args, "--format="+msg.Format)
		}
		if msg.ReportNumber != "" {
			args = append(args, "--report="+msg.ReportNumber)
		}
		cmd := exec.Command("node", args...)
		cmd.Dir = msg.JobberPath
		out, err := cmd.CombinedOutput()
		if err != nil {
			return screens.PipelinePDFGeneratedMsg{Err: summarizeCmdError(err, out)}
		}
		pdfAbs := filepath.Join(msg.JobberPath, filepath.FromSlash(msg.PDFPath))
		if err := openChecked(pdfAbs); err != nil {
			return screens.PipelinePDFGeneratedMsg{Err: fmt.Sprintf("PDF generated but could not open: %v", err)}
		}
		return screens.PipelinePDFGeneratedMsg{Path: pdfAbs}
	}
}

// summarizeCmdError condenses a failed command into one help-bar-sized line:
// the last non-empty output line when there is one (generate-pdf.mjs prints
// its error there), otherwise the exec error itself.
func summarizeCmdError(err error, out []byte) string {
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); line != "" {
			return line
		}
	}
	return err.Error()
}

func (m appModel) View() string {
	switch m.state {
	case viewReport:
		return m.viewer.View()
	case viewProgress:
		return m.progress.View()
	default:
		return m.pipeline.View()
	}
}

func main() {
	pathFlag := flag.String("path", ".", "Path to Jobber directory")
	langFlag := flag.String("lang", "", "Language for UI (en, tr). Defaults to auto-detect/en.")
	flag.Parse()

	if *langFlag != "" {
		i18n.SetLang(*langFlag)
	} else if os.Getenv("LANG") != "" {
		i18n.SetLang(os.Getenv("LANG"))
	}

	jobberPath := *pathFlag

	// Load applications
	apps := data.ParseApplications(jobberPath)
	if apps == nil {
		fmt.Fprintf(os.Stderr, "Error: could not find applications.md in %s or %s/data/\n", jobberPath, jobberPath)
		os.Exit(1)
	}

	// Compute metrics
	metrics := data.ComputeMetrics(apps)
	progressMetrics := data.ComputeProgressMetrics(apps)

	// Batch-load all report summaries
	t := theme.NewTheme("auto")
	pm := screens.NewPipelineModel(t, apps, metrics, jobberPath, 120, 40)

	for _, app := range apps {
		if app.ReportPath == "" {
			continue
		}
		archetype, tldr, remote, comp := data.LoadReportSummary(jobberPath, app.ReportPath)
		if archetype != "" || tldr != "" || remote != "" || comp != "" {
			pm.EnrichReport(app.ReportPath, archetype, tldr, remote, comp)
		}
	}

	m := appModel{
		pipeline:        pm,
		jobberPath:   jobberPath,
		theme:           t,
		progressMetrics: progressMetrics,
	}

	p := tea.NewProgram(m, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
