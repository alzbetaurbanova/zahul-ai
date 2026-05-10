# Scheduler

The **Scheduler** in the web panel sends messages to Discord **channels** or **DMs** on a timer. Two kinds of tasks exist: one-off **Reminders** and repeating **Schedules**.

## Task types

### Reminder

A single message at a set date and time. After it fires, the task is finished.

### Schedule

Repeating pattern: daily, weekly (pick days), monthly, or yearly.

## Create a task

1. Open **Scheduler**.
2. Click **New Task**.
3. Choose **Reminder** or **Schedule**.
4. Fill in:

| Field | Description |
|---|---|
| **Name** | Label (especially for schedules) |
| **Character** | Which persona sends the message |
| **Target** | Channel or DM |
| **Message mode** | Exact vs generate (see below) |
| **Date/Time** (Reminder) | When to send - timezone: **Europe/Bratislava** |
| **Repeat pattern** (Schedule) | Daily / weekly / monthly / yearly |

5. Save.

## Message modes

| Mode | Behavior |
|---|---|
| **Exact** | Sends your text unchanged |
| **Generate** | Your text is an instruction; the character generates the outgoing message |

## Generate mode and history

You can let the model see recent channel history so the line fits the conversation; enable **Message history** and set how many messages to include.

## Edit and delete

Open a task from the list to edit. Delete from the task detail view. Deleted tasks are not recovered by default.

## Timezone

Schedule times use **Europe/Bratislava**. Convert from your local zone when planning.

## Discord shortcut

Users can also create one-off reminders with **`/reminder`** in Discord; see [Slash commands](06-slash-commands.md).
