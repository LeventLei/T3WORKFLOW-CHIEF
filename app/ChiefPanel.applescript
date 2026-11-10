-- Chief 工作流 macOS app (stay-open applet). Built by app/build-mac-app.sh,
-- which fills in the repo and node paths below.
-- Open: start the panel server if needed, then open it in the browser.
-- Quit (Dock / Cmd+Q): stop the server this app started.

property repoDir : "__REPO_DIR__"
property nodePath : "__NODE_PATH__"
property panelPort : "4317"
property startedHere : false

on run
	set startedHere to false
	showPanel()
end run

on reopen
	showPanel()
end reopen

on showPanel()
	set panelUrl to "http://127.0.0.1:" & panelPort & "/"
	if not panelUp() then
		set logFile to "$HOME/Library/Logs/chief-panel.log"
		-- Every fd of the background node is redirected, so do shell script returns
		-- at once; $! is node itself (nohup execs it), so quit can stop it.
		do shell script "cd " & quoted form of repoDir & " || exit 1; nohup " & quoted form of nodePath & " panel/server.mjs --port " & panelPort & " < /dev/null >> \"" & logFile & "\" 2>&1 & echo $! > \"$HOME/Library/Logs/chief-panel.pid\""
		set startedHere to true
		repeat 30 times
			delay 0.2
			if panelUp() then exit repeat
		end repeat
		if not panelUp() then
			set tailText to do shell script "tail -n 12 \"" & logFile & "\" 2>/dev/null || true"
			display alert "Chief 工作流面板没能启动" message ("日志：~/Library/Logs/chief-panel.log" & return & return & tailText) as critical
			quit
			return
		end if
	end if
	open location panelUrl
end showPanel

on panelUp()
	try
		do shell script "curl -sf -o /dev/null --max-time 1 http://127.0.0.1:" & panelPort & "/api/state"
		return true
	on error
		return false
	end try
end panelUp

on quit
	if startedHere then
		do shell script "pid=$(cat \"$HOME/Library/Logs/chief-panel.pid\" 2>/dev/null) && kill \"$pid\" 2>/dev/null; rm -f \"$HOME/Library/Logs/chief-panel.pid\"; true"
		set startedHere to false
	end if
	continue quit
end quit
