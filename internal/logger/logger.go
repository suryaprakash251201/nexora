// Package logger provides a minimal structured JSON logger with level
// filtering. It avoids heavy dependencies while producing consistent,
// machine-readable output.
package logger

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

func (l Level) String() string {
	return []string{"debug", "info", "warn", "error"}[l]
}

func parseLevel(s string) Level {
	switch strings.ToLower(s) {
	case "debug":
		return LevelDebug
	case "warn", "warning":
		return LevelWarn
	case "error":
		return LevelError
	default:
		return LevelInfo
	}
}

// Logger is a small structured logger writing JSON lines to a writer.
type Logger struct {
	mu      sync.Mutex
	out     *os.File
	min     Level
	service string
}

// New creates a logger writing to stderr with the given level and service name.
func New(level, service string) *Logger {
	return &Logger{
		out:     os.Stderr,
		min:     parseLevel(level),
		service: service,
	}
}

func (l *Logger) log(level Level, msg string, fields map[string]any) {
	if level < l.min {
		return
	}
	_, file, line, ok := runtime.Caller(2)
	if !ok {
		file, line = "?", 0
	} else {
		file = filepath.Base(file)
	}
	rec := map[string]any{
		"ts":      time.Now().UTC().Format(time.RFC3339Nano),
		"level":   level.String(),
		"service": l.service,
		"msg":     msg,
		"caller":  fmt.Sprintf("%s:%d", file, line),
	}
	for k, v := range fields {
		rec[k] = v
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return
	}
	l.mu.Lock()
	l.out.Write(append(b, '\n'))
	l.mu.Unlock()
}

func (l *Logger) Debug(msg string, fields ...any) { l.log(LevelDebug, msg, toMap(fields)) }
func (l *Logger) Info(msg string, fields ...any)  { l.log(LevelInfo, msg, toMap(fields)) }
func (l *Logger) Warn(msg string, fields ...any)  { l.log(LevelWarn, msg, toMap(fields)) }
func (l *Logger) Error(msg string, fields ...any) { l.log(LevelError, msg, toMap(fields)) }

func toMap(fields []any) map[string]any {
	m := make(map[string]any, len(fields)/2)
	for i := 0; i+1 < len(fields); i += 2 {
		key, ok := fields[i].(string)
		if !ok {
			key = fmt.Sprintf("%v", fields[i])
		}
		m[key] = fields[i+1]
	}
	return m
}
