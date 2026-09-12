import { describe, expect, it } from "vitest";
import {
  describeGoogleError,
  fromGoogleEvent,
  fromGoogleTask,
  isClientIdFormatValid,
} from "../google";

describe("isClientIdFormatValid", () => {
  it("accepts a real client-ID shape", () => {
    expect(
      isClientIdFormatValid(
        "1061073046956-v2gsouop5dqha5diu6q2bsg3t9p52o07.apps.googleusercontent.com",
      ),
    ).toBe(true);
  });

  it("rejects secrets, API keys and empty input", () => {
    expect(isClientIdFormatValid("")).toBe(false);
    expect(isClientIdFormatValid("GOCSPX-AbCdEfGhIjKlMnOp")).toBe(false);
    expect(isClientIdFormatValid("AIzaSyAbCdEfGhIjKlMnOpQrStUv")).toBe(false);
    expect(isClientIdFormatValid("1061073046956-v2gsouop5dqha5diu6q2bsg3t9p52o07")).toBe(false);
  });
});

describe("describeGoogleError", () => {
  it("explains every connect code the UI can produce", () => {
    for (const code of [
      "missing-client-id",
      "invalid-client-id",
      "gis-blocked",
      "gis-unavailable",
      "auth-cancelled",
      "google-popup_closed_by_user",
      "google-access_denied",
      "google-unauthorized",
      "google-error-403",
      "google-error-500",
    ]) {
      const info = describeGoogleError(new Error(code));
      expect(info.title.length).toBeGreaterThan(0);
      expect(info.detail.length).toBeGreaterThan(0);
    }
  });

  it("points origin-mismatch failures at Authorized JavaScript origins", () => {
    const info = describeGoogleError(new Error("google-some_new_gis_code"));
    expect(info.detail).toMatch(/Authorized JavaScript origins/);
  });
});

describe("google mappers", () => {
  it("maps timed and all-day calendar events to local inputs", () => {
    const timed = fromGoogleEvent({
      id: "abc",
      summary: "Standup",
      start: { dateTime: "2026-09-14T09:30:00+05:30" },
      end: { dateTime: "2026-09-14T10:00:00+05:30" },
    });
    expect(timed.googleId).toBe("abc");
    expect(timed.source).toBe("google");
    expect(timed.dateOnly).toBe(false);
    expect(timed.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    const allDay = fromGoogleEvent({
      id: "d",
      summary: "Holiday",
      start: { date: "2026-09-15" },
      end: { date: "2026-09-16" },
    });
    expect(allDay.dateOnly).toBe(true);
    expect(allDay.start).toBe("2026-09-15T00:00");
  });

  it("maps task completion status and due dates", () => {
    const done = fromGoogleTask(
      { id: "t1", title: "File taxes", status: "completed", due: "2026-03-01T00:00:00.000Z" },
      "list-1",
    );
    expect(done.completed).toBe(true);
    expect(done.due).toBe("2026-03-01");
    expect(done.listId).toBe("list-1");

    const open = fromGoogleTask({ id: "t2", title: "Buy milk", status: "needsAction" }, "list-1");
    expect(open.completed).toBe(false);
    expect(open.due).toBeUndefined();
  });
});
