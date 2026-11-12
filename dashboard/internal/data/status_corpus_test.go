package data

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

// TestNormalizeStatusMatchesCorpus is the gate for the go_dashboard column of
// tests/fixtures/status-alias-corpus.tsv: every row's spelling goes through the REAL
// NormalizeStatus and must equal the recorded cell. A stale corpus fails here.
//
// Corpus vocabulary (mirrors tests/status-normalizers-golden.test.mjs): a lowercase
// canonical state id, or "-" when the normalizer does not recognise the spelling. Go's
// default branch returns the cleaned input unchanged, so anything outside the canonical
// ids is "-". Spellings are not trimmed; <empty>/<space>/<nbsp> encode blank input.
func TestNormalizeStatusMatchesCorpus(t *testing.T) {
	const path = "../../../tests/fixtures/status-alias-corpus.tsv"
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("alias corpus missing or unreadable (%s): %v", path, err)
	}
	canonical := map[string]bool{}
	for _, s := range States {
		canonical[s.ID] = true
	}
	placeholders := map[string]string{"<empty>": "", "<space>": " ", "<nbsp>": " "}

	lines := strings.Split(string(raw), "\n")
	header := strings.Split(strings.TrimSuffix(lines[0], "\r"), "\t")
	col := -1
	for i, h := range header {
		if h == "go_dashboard" {
			col = i
		}
	}
	if header[0] != "spelling" || col < 0 {
		t.Fatalf("unexpected corpus header %q (want spelling ... go_dashboard)", header)
	}

	rows := 0
	var bad []string
	for n, line := range lines[1:] {
		line = strings.TrimSuffix(line, "\r")
		if line == "" {
			continue
		}
		cells := strings.Split(line, "\t")
		if len(cells) <= col {
			t.Fatalf("corpus line %d has %d cells, need %d", n+2, len(cells), col+1)
		}
		spelling := cells[0]
		if v, ok := placeholders[spelling]; ok {
			spelling = v
		}
		got := NormalizeStatus(spelling)
		if !canonical[got] {
			got = "-"
		}
		rows++
		if got != cells[col] {
			bad = append(bad, fmt.Sprintf("line %d %q: corpus=%s real=%s", n+2, spelling, cells[col], got))
		}
	}
	if rows < 300 {
		t.Fatalf("only %d corpus rows read; corpus truncated or mis-parsed", rows)
	}
	if len(bad) > 0 {
		t.Errorf("%d of %d corpus rows disagree with the real NormalizeStatus:\n%s", len(bad), rows, strings.Join(bad, "\n"))
	}
}
