# Photo fixtures for the page-corner detector (D-51)

Three **AI-generated** images of invoices lying on a desk, supplied by the project owner (made with another tool).
They are not real photographs, and every name, number and amount on them is fictional.

| File | Page | What makes it hard |
|---|---|---|
| `generated-de-rechnung.jpg` | German invoice on a dark desk | diagonal light bands across page and desk; a sunlit band of desk touches the page |
| `generated-zh-receipt.jpg` | Chinese receipt on a light-gray desk | sunlit desk as bright as the paper on one side |
| `generated-en-invoice.jpg` | English invoice on a light-gray desk | sunlit desk; glare over the header |

The region detector (D-49) finds no page in any of them, because the lit desk merges with the paper. The edge
candidate stage (D-51) finds all three. The expected corners in `src/tests/corners.test.ts` are the detector's own
output, checked by eye (zoomed crops of every corner, and gray profiles across every side: the paper edge lies within
about 4 px of each fitted side). They are not independent ground truth, so the test is a regression guard.

These images do not replace the real-photo check that release waits on: 3–5 real phone photos, including a flat
scan and a blank sheet on a white table.
