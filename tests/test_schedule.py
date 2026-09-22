"""
Scheduling: when a repeating task fires next, and what the API refuses to save.

A reminder that computes a time in the past fires immediately and spams the
channel; one that computes the wrong weekday just never arrives, silently. The
tests avoid freezing the clock - they assert the properties that must hold
whenever the suite happens to run (always in the future, always on an allowed
day, always on the requested minute).
"""
from calendar import monthrange
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from api.routers.tasks import (
    _parse_iso_datetime,
    _validate_repeat_pattern,
    compute_next_run,
)

SK = ZoneInfo("Europe/Bratislava")


def schedule(pattern: dict, status: str = "active") -> dict:
    return {"type": "schedule", "status": status, "repeat_pattern": pattern}


def parse(result: str) -> datetime:
    return datetime.fromisoformat(result).replace(tzinfo=SK)


class TestNextRun:
    def test_a_daily_task_is_always_scheduled_ahead_of_now(self):
        for hour in range(0, 24, 3):
            result = compute_next_run(schedule({"type": "daily", "time": f"{hour:02d}:30"}))

            assert result is not None
            moment = parse(result)
            assert moment > datetime.now(SK)
            assert (moment.hour, moment.minute) == (hour, 30)
            # Never more than a day away - that would mean a whole day skipped.
            assert moment - datetime.now(SK) < timedelta(days=1, minutes=1)

    def test_a_weekly_task_lands_on_one_of_its_days(self):
        days = [0, 3]  # Monday and Thursday
        result = compute_next_run(schedule({"type": "weekly", "time": "08:15", "days": days}))

        assert result is not None
        moment = parse(result)
        assert moment > datetime.now(SK)
        assert moment.weekday() in days
        assert (moment.hour, moment.minute) == (8, 15)
        assert moment - datetime.now(SK) <= timedelta(days=8)

    def test_a_weekly_task_for_every_day_behaves_like_a_daily_one(self):
        result = compute_next_run(schedule({"type": "weekly", "time": "12:00", "days": [0, 1, 2, 3, 4, 5, 6]}))

        assert result is not None
        assert parse(result) - datetime.now(SK) < timedelta(days=1, minutes=1)

    def test_a_monthly_and_a_yearly_task_are_also_in_the_future(self):
        monthly = compute_next_run(schedule({"type": "monthly", "time": "09:00", "day": 1}))
        yearly = compute_next_run(schedule({"type": "yearly", "time": "09:00", "month": 1, "day": 1}))

        assert parse(monthly) > datetime.now(SK)
        assert parse(yearly) > datetime.now(SK)

    @pytest.mark.parametrize("day", [28, 29, 30, 31])
    def test_a_monthly_task_near_the_end_of_the_month_still_fires(self, day):
        """
        The 31st does not exist in September - the task has to land on the last
        day of the month instead of being skipped for the whole month.
        """
        result = compute_next_run(schedule({"type": "monthly", "time": "09:00", "day": day}))

        assert result is not None, f"a monthly task on day {day} would never run"
        moment = parse(result)
        assert moment > datetime.now(SK)
        assert moment.day == min(day, monthrange(moment.year, moment.month)[1])
        assert (moment.hour, moment.minute) == (9, 0)

    def test_a_yearly_task_on_29_february_falls_back_to_the_28th(self):
        result = compute_next_run(schedule({"type": "yearly", "time": "09:00", "month": 2, "day": 29}))

        assert result is not None, "a yearly task on 29 February would only run in a leap year"
        moment = parse(result)
        assert moment > datetime.now(SK)
        assert moment.month == 2
        assert moment.day == (29 if monthrange(moment.year, 2)[1] == 29 else 28)

    def test_a_malformed_day_or_month_is_not_guessed(self):
        assert compute_next_run(schedule({"type": "monthly", "time": "09:00", "day": "last"})) is None
        assert compute_next_run(schedule({"type": "yearly", "time": "09:00", "month": 13, "day": 1})) is None

    def test_a_paused_schedule_has_no_next_run(self):
        assert compute_next_run(schedule({"type": "daily", "time": "09:00"}, status="paused")) is None

    def test_a_pattern_without_a_time_is_not_guessed(self):
        assert compute_next_run(schedule({"type": "daily"})) is None
        assert compute_next_run(schedule({"type": "daily", "time": "nonsense"})) is None

    def test_a_weekly_pattern_without_days_is_not_guessed(self):
        assert compute_next_run(schedule({"type": "weekly", "time": "09:00", "days": []})) is None

    def test_an_upcoming_reminder_keeps_its_own_time(self):
        task = {"type": "reminder", "status": "upcoming", "scheduled_time": "2030-01-01T10:00:00"}

        assert compute_next_run(task) == "2030-01-01T10:00:00"

    def test_a_reminder_that_already_fired_is_not_rescheduled(self):
        # The bug this guards: a sent/failed reminder coming back to life.
        for status in ("sent", "failed", "cancelled"):
            task = {"type": "reminder", "status": status, "scheduled_time": "2020-01-01T10:00:00"}
            assert compute_next_run(task) is None


class TestPatternValidation:
    def test_accepts_the_four_supported_shapes(self):
        _validate_repeat_pattern({"type": "daily", "time": "09:00"})
        _validate_repeat_pattern({"type": "weekly", "time": "09:00", "days": [0, 6]})
        _validate_repeat_pattern({"type": "monthly", "time": "09:00", "day": 31})
        _validate_repeat_pattern({"type": "yearly", "time": "09:00", "month": 12, "day": 24})

    @pytest.mark.parametrize(
        "pattern",
        [
            {"type": "hourly", "time": "09:00"},
            {"type": "daily"},
            {"type": "daily", "time": "9:00"},
            {"type": "daily", "time": "24:00"},
            {"type": "daily", "time": "09:60"},
            {"type": "daily", "time": 900},
            {"type": "weekly", "time": "09:00"},
            {"type": "weekly", "time": "09:00", "days": []},
            {"type": "weekly", "time": "09:00", "days": [7]},
            {"type": "weekly", "time": "09:00", "days": ["monday"]},
            {"type": "monthly", "time": "09:00", "day": 0},
            {"type": "monthly", "time": "09:00", "day": 32},
            {"type": "yearly", "time": "09:00", "month": 13, "day": 1},
            {"type": "yearly", "time": "09:00", "month": 1, "day": 32},
        ],
    )
    def test_refuses_a_pattern_that_could_never_fire_correctly(self, pattern):
        with pytest.raises(HTTPException) as raised:
            _validate_repeat_pattern(pattern)
        assert raised.value.status_code == 400


class TestIsoParsing:
    def test_accepts_the_zulu_suffix_browsers_send(self):
        assert _parse_iso_datetime("2030-01-01T10:00:00Z").utcoffset() == timedelta(0)

    def test_accepts_a_plain_local_timestamp(self):
        assert _parse_iso_datetime(" 2030-01-01T10:00:00 ").hour == 10

    def test_rejects_something_that_is_not_a_timestamp(self):
        with pytest.raises(ValueError):
            _parse_iso_datetime("tomorrow")
