# Account deletion: focus after cancellation

With the app running, open Accounts → Edit. Inspect the trash button in the
browser's Elements panel, then run this in the console (`$0` is the selected element):

```js
window.deleteTrigger = $0.closest("button");
console.assert(window.deleteTrigger, "Select the trash button first");
```

Return to the page, open the trash dialog, and choose Cancel. Then run:

```js
console.assert(
  document.activeElement === window.deleteTrigger,
  "Cancelling deletion must return keyboard focus to the trash button",
);
```

Repeat with Escape, the close button, and the backdrop. Also repeat for an archived
account. Opening the edit form must not move focus from its first field to Trash.
All checks cancel the dialog; no account should be deleted.
