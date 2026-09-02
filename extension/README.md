# TailorResume Chrome extension

This unpacked Manifest V3 extension reads the current job posting and asks the local
TailorResume service to generate the tailored Google Doc and PDF. It does not inspect,
fill, upload to, or submit an application form.

## Install

1. In PowerShell, run `npm.cmd run app` from the repository root.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select `E:\TailorResume\extension`.
5. Pin **TailorResume** and click it while viewing a job posting.

## Use

1. Click **Read current job page**. If the page is noisy, select the job-description
   text first and click the button again.
2. Verify or edit Company, Role, and Job description.
3. Click **Generate tailored resume**.
4. Open the resulting PDF and attach it to the application manually.
5. Use **Generate answer** under **Why this company**, edit the draft if needed, and
   copy it into the application yourself.

After a successful read, the extension stores the canonical job URL together with its
JD, company, role, and inspection time. Opening the same job later shows **Already
inspected** and restores the saved details instead of inspecting or calling the model
again. Existing application snapshots are also treated as previously inspected.

The generated snapshot is bound to its browser tab. Navigating from a job-description
URL to a different application URL in the same tab keeps the correct resume and
Why-this-company draft. When an application link opens a new tab, the new tab inherits
the source tab's binding. The card always names the company and role it is bound to.

The extension tries local ports 4317 and 4318.
