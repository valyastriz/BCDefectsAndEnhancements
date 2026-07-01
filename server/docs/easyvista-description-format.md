# EasyVista API — description field format

When submitting to the real EasyVista API, all submission fields go into **one
description field** as an HTML table (label/value rows). The current
`server/src/easyvista.js` builds a plain-text description and must be switched
to this format when the real API is wired up (API details/credentials TBD).

Sample of the expected HTML, captured from a real EasyVista ticket
(2026-07-01). Each field is a `<tr>` with a blue Arial 12px label cell and
value cell; long text values end with `<br>`:

```html
<table border="0" cellpadding="5px">
<tbody>
<tr><td colspan="2"><h4>Details</h4><hr></td></tr>
<tr><td style="padding: 8px;"><span style="color: #0000ff;font-family:arial;font-size:12px;">Policy#/Submission#</td><td style="font-family:arial;color:blue;font-size:12px;padding-left:5px;">2897004</span></td></tr>
<tr><td style="padding: 8px;"><span style="color: #0000ff;font-family:arial;font-size:12px;">Summary of Issue</td><td style="font-family:arial;color:blue;font-size:12px;padding-left:5px;">EP Without NOC</span></td></tr>
<tr><td style="padding: 8px;"><span style="color: #0000ff;font-family:arial;font-size:12px;">Screen Title</td><td style="font-family:arial;color:blue;font-size:12px;padding-left:5px;">Delinquencies</span></td></tr>
<tr><td style="padding: 8px;"><span style="color: #0000ff;font-family:arial;font-size:12px;">Steps To Reproduce</td><td style="font-family:arial;color:blue;font-size:12px;padding-left:5px;">-<br></span></td></tr>
<tr><td style="padding: 8px;"><span style="color: #0000ff;font-family:arial;font-size:12px;">What happened (Exact Details)</td><td style="font-family:arial;color:blue;font-size:12px;padding-left:5px;">The earned premium process kicked off without first issuing a Notice of Cancellation.<br></span></td></tr>
<tr><td style="padding: 8px;"><span style="color: #0000ff;font-family:arial;font-size:12px;">Requestor</td><td style="font-family:arial;color:blue;font-size:12px;padding-left:5px;">Riebel, Lachelle</span></td></tr>
<tr><td style="padding: 8px;"><span style="color: #0000ff;font-family:arial;font-size:12px;">Time/Date of Error</td><td style="font-family:arial;color:blue;font-size:12px;padding-left:5px;">03/10/2026 12:00:00 pm</span></td></tr>
</tbody>
</table>
```

Notes for implementation:

- The sample's tags are unbalanced (`<span>` opens in the label cell and
  closes in the value cell) — reproduce the structure EasyVista expects rather
  than "fixing" it, unless testing shows balanced markup renders the same.
- Field values must be HTML-escaped before interpolation (user-submitted
  text goes into this table).
- Labels observed so far: Policy#/Submission#, Summary of Issue, Screen
  Title, Steps To Reproduce, What happened (Exact Details), Requestor,
  Time/Date of Error. The full label list for defects vs. enhancements is
  still to be confirmed.
- The "Respond to User" mailto button (`buildRespondToUserMailto` in
  `client/src/utils/formatUtils.js`) intentionally stays plain text —
  `mailto:` cannot carry HTML.
