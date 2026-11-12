package screens

// openPDFPickerForTest opens the PDF picker overlay. No key binding opens it today (the
// `d` key opens the newest PDF directly), so tests set its state directly.
func openPDFPickerForTest(m PipelineModel, choices []string) PipelineModel {
	m.overlay = overlayPDF
	m.pdfCursor = 0
	m.pdfChoices = choices
	return m
}
