# Scheduler

The Scheduler sends messages to Discord channels or DMs on a schedule. Two task types are supported: one-off **Reminders** and recurring **Schedules**.

## Task types

### Reminder

A one-time message sent at a specific date and time. After it fires, the task is done.

Use for: announcements, countdowns, one-off events.

### Schedule

A recurring message sent on a repeating pattern — daily, weekly, monthly, or yearly.

Use for: daily check-ins, weekly roundups, recurring server announcements.

## Creating a task

1. Go to **Scheduler** in the panel
2. Click **New Task**
3. Choose **Reminder** or **Schedule**
4. Fill in:

| Field | Description |
|---|---|
| **Name** | Label for the task (schedules only) |
| **Character** | Which character sends the message |
| **Target** | Channel or DM |
| **Message mode** | See below |
| **Date/Time** (Reminder) | When to send — uses Europe/Bratislava timezone |
| **Repeat pattern** (Schedule) | Daily / Weekly (pick days) / Monthly / Yearly |

5. Click **Save**

## Message modes

| Mode | Behavior |
|---|---|
| **Exact** | Sends the text as-is — no AI involved |
| **Generate** | Passes your text as instructions to the AI character, which generates the actual message |

**Generate** lets you write a prompt like `"Write a motivational Monday morning message"` and let the character produce the content each time.

## Message history (Generate mode)

When Generate mode is on, you can optionally give the AI access to recent channel history. Toggle **Message history** and set how many past messages to include. This lets the AI respond in context rather than generating a standalone message.

## Editing and deleting tasks

Click any task in the list to edit it. To delete, open the task and click **Delete**. Deleted tasks cannot be recovered.

## Recurring schedules — timing

Schedules fire at the time you set on the configured repeat days. The timezone used is **Europe/Bratislava** — adjust your time accordingly if you're in a different timezone.
