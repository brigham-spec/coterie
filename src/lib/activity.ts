// Activity event types. Activity rows are written in one place (the company
// lifecycle actions) and read in another (the relationship timeline); binding
// the wire value to a shared constant keeps the writer and reader from silently
// drifting apart if the string is ever changed.

export const ACTIVITY_STATUS_CHANGED = "status_changed";
