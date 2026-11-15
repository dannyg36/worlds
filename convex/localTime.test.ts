import { describe, expect, test } from "vitest";
import {
  isTimeZone,
  localDate,
  nextLocalTime,
  startOfLocalDay,
} from "./localTime";

const at = (iso: string) => new Date(iso).getTime();
const iso = (time: number) => new Date(time).toISOString();
const NINE_PM = 21 * 60;

describe("nextLocalTime", () => {
  test("finds tonight's slot in the device's own zone", () => {
    const now = at("2026-11-15T10:00:00Z");
    expect(iso(nextLocalTime(now, "America/Los_Angeles", NINE_PM))).toBe(
      "2026-11-16T05:00:00.000Z",
    );
    expect(iso(nextLocalTime(now, "Asia/Tokyo", NINE_PM))).toBe(
      "2026-11-15T12:00:00.000Z",
    );
    expect(iso(nextLocalTime(now, "Asia/Kolkata", NINE_PM + 30))).toBe(
      "2026-11-15T16:00:00.000Z",
    );
  });

  test("moves to tomorrow once tonight's slot has passed or was used", () => {
    const tokyoNinePm = at("2026-11-15T12:00:00Z");
    expect(iso(nextLocalTime(tokyoNinePm, "Asia/Tokyo", NINE_PM))).toBe(
      "2026-11-16T12:00:00.000Z",
    );
    expect(
      iso(
        nextLocalTime(
          at("2026-11-15T10:00:00Z"),
          "Asia/Tokyo",
          NINE_PM,
          "2026-11-15",
        ),
      ),
    ).toBe("2026-11-16T12:00:00.000Z");
  });

  test("keeps 9pm local across the end of daylight saving time", () => {
    const first = nextLocalTime(
      at("2026-10-31T12:00:00Z"),
      "America/New_York",
      NINE_PM,
    );
    expect(iso(first)).toBe("2026-11-01T01:00:00.000Z");
    expect(iso(nextLocalTime(first, "America/New_York", NINE_PM))).toBe(
      "2026-11-02T02:00:00.000Z",
    );
  });

  test("keeps 9pm local across the start of daylight saving time", () => {
    const first = nextLocalTime(
      at("2027-03-13T12:00:00Z"),
      "Europe/London",
      NINE_PM,
    );
    expect(iso(first)).toBe("2027-03-13T21:00:00.000Z");
    expect(iso(nextLocalTime(at("2027-03-28T12:00:00Z"), "Europe/London", NINE_PM))).toBe(
      "2027-03-28T20:00:00.000Z",
    );
  });
});

describe("wall times skipped by daylight saving", () => {
  test("move forward past the gap instead of firing early", () => {
    const twoThirty = 2 * 60 + 30;
    expect(
      iso(nextLocalTime(at("2027-03-14T05:00:00Z"), "America/New_York", twoThirty)),
    ).toBe("2027-03-14T07:30:00.000Z");
    expect(
      iso(nextLocalTime(at("2027-03-27T12:00:00Z"), "Europe/London", 60 + 30, "2027-03-27")),
    ).toBe("2027-03-28T01:30:00.000Z");
  });
});

describe("local days", () => {
  test("uses the device's calendar date, not UTC's", () => {
    const lateEvening = at("2026-11-16T07:30:00Z");
    expect(localDate(lateEvening, "America/Los_Angeles")).toBe("2026-11-15");
    expect(localDate(lateEvening, "Asia/Tokyo")).toBe("2026-11-16");
    expect(iso(startOfLocalDay(lateEvening, "America/Los_Angeles"))).toBe(
      "2026-11-15T08:00:00.000Z",
    );
    expect(iso(startOfLocalDay(at("2026-11-01T12:00:00Z"), "America/New_York"))).toBe(
      "2026-11-01T04:00:00.000Z",
    );
  });

  test("recognizes IANA zone names", () => {
    expect(isTimeZone("America/Los_Angeles")).toBe(true);
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});
