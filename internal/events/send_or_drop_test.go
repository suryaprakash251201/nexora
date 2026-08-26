package events

// Tests for sendOrDrop (Phase 2 / P1-8).
//
// The contract is: subscribers own the lifecycle of their channel; the
// bus never closes it. But a future refactor or a buggy caller could
// violate that, and the old code would panic from inside Emit
// ("send on closed channel"), crashing the request handler that emitted
// the event. sendOrDrop recovers from the panic and treats the event
// as dropped.

import (
	"testing"
)

// TestSendOrDrop_SuccessDelivers verifies the happy path: an open
// buffered channel receives the event.
func TestSendOrDrop_SuccessDelivers(t *testing.T) {
	ch := make(chan Event, 1)
	sendOrDrop(nil, ch, Event{Type: EventFileCreated, Path: "ok"})
	select {
	case got := <-ch:
		if got.Type != EventFileCreated || got.Path != "ok" {
			t.Errorf("got = %+v, want file.created / ok", got)
		}
	default:
		t.Fatal("event was not delivered")
	}
}

// TestSendOrDrop_FullChannelDrops verifies the non-blocking drop: a
// full channel returns without blocking.
func TestSendOrDrop_FullChannelDrops(t *testing.T) {
	ch := make(chan Event, 1)
	ch <- Event{Type: EventFileCreated, Path: "first"} // fill
	sendOrDrop(nil, ch, Event{Type: EventFileCreated, Path: "second"})
	// The first event is still in the channel; the second was dropped.
	got := <-ch
	if got.Path != "first" {
		t.Errorf("got = %+v, want first", got)
	}
}

// TestSendOrDrop_ClosedChannelDoesNotPanic is the regression test for
// P1-8: a closed channel must not propagate the panic. We invoke
// sendOrDrop via a deferred-recover wrapper because the test framework
// cannot tolerate a panic in the goroutine running the test.
func TestSendOrDrop_ClosedChannelDoesNotPanic(t *testing.T) {
	ch := make(chan Event, 1)
	close(ch) // a subscriber bug closed the channel out from under the bus

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("sendOrDrop propagated the panic: %v", r)
		}
	}()
	sendOrDrop(nil, ch, Event{Type: EventFileCreated, Path: "after-close"})
	// If we reach here, the recover inside sendOrDrop worked.
}

// TestSendOrDrop_OpenChanAndClosedChanInSequence exercises a bus-like
// scenario: the bus has multiple subscribers; one of them is closed
// (e.g. via a concurrent Unsubscribe that left a stale reference in
// the listener slice), and the bus's Emit must not crash when
// delivering to the closed one alongside open ones.
func TestSendOrDrop_OpenChanAndClosedChanInSequence(t *testing.T) {
	open := make(chan Event, 4)
	closed := make(chan Event, 1)
	close(closed)

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("sendOrDrop on mixed listeners panicked: %v", r)
		}
	}()

	sendOrDrop(nil, closed, Event{Type: EventFileCreated, Path: "to-closed"})
	sendOrDrop(nil, open, Event{Type: EventFileCreated, Path: "to-open"})

	// The open channel received the second event.
	select {
	case got := <-open:
		if got.Path != "to-open" {
			t.Errorf("open chan got = %+v, want to-open", got)
		}
	default:
		t.Fatal("open channel did not receive the event")
	}
}
