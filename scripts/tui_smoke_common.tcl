# Shared helpers for Stack OpenTUI expect smokes.

proc stack_tui_smoke_env {repo_root smoke_dir} {
  global env

  file delete -force $smoke_dir
  file mkdir $smoke_dir

  set env(STACK_SESSION_DIR) $smoke_dir
  set env(STACK_WORKING_DIR) $smoke_dir
  set env(STACK_OPTIMIZER_SERVICE_URL) "http://127.0.0.1:65534"
  set env(STACK_OPTIMIZER_DB) "$smoke_dir/gepa-service.sqlite"
  set env(STACK_OPTIMIZER_LOG) "$smoke_dir/gepa-service.log"
  set env(STACK_OPTIMIZER_PID) "$smoke_dir/gepa-service.pid"
  unset -nocomplain env(SYNTH_API_KEY)
  unset -nocomplain env(SYNTH_STAGING_API_KEY)
  set env(STACK_CODEX_TRANSPORT) "exec"
  set env(STACK_MONITOR_ENABLED) "0"
}

proc stack_tui_assert_no_crash_artifacts {output} {
  set patterns [list \
    "Failed to create optimized buffer" \
    "OpenTUI buffer allocation crash detected" \
    "Segmentation fault" \
    "SIGSEGV" \
    "Abort trap" \
    "SIGABRT" \
    "out of memory" \
    "ENOMEM" \
    "JavaScript heap out of memory" \
    "Cannot allocate memory" \
    "oh no: Bun has crashed" \
    "stack fatal:" \
    "core dumped" \
    "double free" \
    "heap-use-after-free" \
    "malloc: ***" \
    "std::bad_alloc" \
  ]

  foreach needle $patterns {
    if {[string first $needle $output] >= 0} {
      puts stderr "TUI crash artifact detected: $needle"
      exit 1
    }
  }

  if {[regexp {\;[0-9]+;[0-9]+;[0-9]+M} $output]} {
    puts stderr "raw SGR mouse tracking sequences leaked into terminal output"
    exit 1
  }
}

proc stack_tui_kill_spawned_stack {} {
  global spawn_id

  if {![info exists spawn_id]} {
    puts stderr "spawn_id missing; cannot kill stack child"
    exit 1
  }

  set pid ""
  if {![catch {exp_pid -spawn_id $spawn_id} pid]} {
    catch {exec pkill -TERM -P $pid}
    catch {exec kill -TERM $pid}
    sleep 0.35
    catch {exec pkill -9 -P $pid}
    if {![catch {exec kill -0 $pid} _]} {
      catch {exec kill -9 $pid}
    }
    return
  }

  set parent [pid]
  if {[catch {exec sh -c "pgrep -P $parent | tail -1"} pid]} {
    puts stderr "could not resolve spawned stack pid"
    exit 1
  }
  set pid [string trim $pid]
  if {$pid eq ""} {
    puts stderr "could not resolve spawned stack pid"
    exit 1
  }
  catch {exec kill -TERM $pid}
  sleep 0.35
  if {![catch {exec kill -0 $pid} _]} {
    exec kill -9 $pid
  }
}

proc stack_tui_has_controlling_tty {} {
  if {[catch {exec test -t 0} _]} {
    return 0
  }
  if {[catch {open "/dev/tty" r+} tty]} {
    return 0
  }
  close $tty
  return 1
}

proc stack_tui_send_tty {data} {
  set tty [open "/dev/tty" w]
  fconfigure $tty -encoding binary -translation binary -buffering none
  puts -nonewline $tty $data
  flush $tty
  close $tty
}

proc stack_tui_read_tty_until {pattern timeout_ms} {
  if {[catch {open "/dev/tty" r+} tty]} {
    return ""
  }
  fconfigure $tty -encoding binary -translation binary -blocking 0 -buffering none
  set deadline [expr {[clock milliseconds] + $timeout_ms}]
  set response ""
  while {[clock milliseconds] < $deadline} {
    if {[eof $tty]} {
      break
    }
    set chunk [read $tty]
    if {$chunk ne ""} {
      append response $chunk
      if {[regexp $pattern $response match]} {
        close $tty
        return $match
      }
    }
    after 20
  }
  close $tty
  return ""
}

proc stack_tui_assert_mouse_tracking_disabled {} {
  if {![stack_tui_has_controlling_tty]} {
    return
  }

  stack_tui_send_tty "\033\[?1049l"
  after 100

  set sgr [stack_tui_read_tty_until {\033\[\?1006;([0-9]+)\$y} 1000]
  if {$sgr eq ""} {
    return
  }
  if {[regexp {\033\[\?1006;1\$y} $sgr]} {
    puts stderr "SGR mouse mode still enabled after stack exit"
    exit 1
  }

  stack_tui_send_tty "\033\[?1000\$p"
  set basic [stack_tui_read_tty_until {\033\[\?1000;([0-9]+)\$y} 1000]
  if {$basic ne "" && [regexp {\033\[\?1000;1\$y} $basic]} {
    puts stderr "basic mouse mode still enabled after stack exit"
    exit 1
  }
}

proc stack_tui_read_output_log {output_log} {
  set handle [open $output_log r]
  set output [read $handle]
  close $handle
  return $output
}

proc stack_tui_expect_running_turn {} {
  expect {
    -re {Thinking|Codex is running} {}
    timeout {
      puts stderr "timed out waiting for running turn indicator"
      exit 1
    }
  }
}
