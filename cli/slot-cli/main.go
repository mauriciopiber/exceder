package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Registry struct {
	Groups   map[string]GroupConfig   `json:"groups,omitempty"`
	Projects map[string]ProjectConfig `json:"projects"`
	Slots    map[string]SlotConfig    `json:"slots"`
}

type GroupConfig struct {
	Name  string `json:"name"`
	Order int    `json:"order"`
}

type ProjectConfig struct {
	BasePort int    `json:"base_port"`
	Path     string `json:"path"`
	Group    string `json:"group,omitempty"`
}

type SlotConfig struct {
	Project   string `json:"project"`
	Number    int    `json:"number"`    // 0 for named slots
	Name      string `json:"name"`      // empty for numbered slots
	Branch    string `json:"branch"`
	CreatedAt string `json:"created_at"`
	Locked    bool   `json:"locked,omitempty"`
	LockNote  string `json:"lock_note,omitempty"`
}

var registryPath = filepath.Join(os.Getenv("HOME"), ".config", "slots", "registry.json")

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(0)
	}

	cmd := os.Args[1]
	args := os.Args[2:]

	switch cmd {
	case "new", "create":
		cmdNew(args)
	case "delete", "rm", "kill":
		cmdDelete(args)
	case "list", "ls", "":
		cmdList()
	case "start":
		cmdStart()
	case "continue":
		cmdContinue()
	case "init":
		cmdInit(args)
	case "check":
		cmdCheck(args)
	case "sync":
		cmdSync()
	case "db-sync":
		cmdDBSync()
	case "merge":
		cmdMerge(args)
	case "done":
		cmdDone(args)
	case "pr":
		cmdPR(args)
	case "lock":
		cmdLock(args)
	case "unlock":
		cmdUnlock(args)
	case "group":
		cmdGroup(args)
	case "clean":
		if len(args) > 0 && args[0] == "claude" {
			cmdCleanClaude(args[1:])
		} else if len(args) > 0 && args[0] == "storybook" {
			cmdCleanStorybook(args[1:])
		} else if len(args) > 0 && args[0] == "web" {
			cmdCleanWeb(args[1:])
		} else if len(args) > 0 && args[0] == "docker" {
			cmdCleanDocker(args[1:])
		} else {
			cmdClean(args)
		}
	case "verify":
		cmdVerify()
	case "fix-ports":
		cmdFixPorts()
	default:
		printUsage()
	}
}

func printUsage() {
	fmt.Println(`slot-cli - Smart slot management for parallel development

Commands:
  new [N|name]      Create slot (number or name, auto-increment if omitted)
  delete <N|name>   Delete slot (use --force to skip confirmation)
  done              Merge current slot into main + cleanup (run from slot)
  pr                Push and create PR for current slot
  list              Show running Claude instances
  start             Start Claude in current directory
  continue          Continue Claude session
  check [N]         Validate slot configuration
  verify            Verify slot matches parent worktree (1:1)
  fix-ports         Fix slot ports to match parent + slot number
  sync              Rebase slot branch on main (pull latest changes)
  db-sync           Clone database from main to current slot
  merge <N>         Merge slot branch into main (run from main)
  lock [note]       Lock current slot (prevents deletion)
  unlock            Unlock current slot
  init [port]       Register current project (auto-detects port and group)
  group list        Show all groups and their projects
  group create      Create a group: group create <id> "<name>"
  group assign      Assign project to group: group assign <project> <group-id>
  clean             Scan for stale worktrees and tmux sessions
  clean claude      List/stop Claude instances (--orphans, --all)
  clean docker      List/stop docker containers (--orphans, --all)
  clean storybook   List/kill storybook processes (--orphans, --all)
  clean web         List/kill web servers (--orphans, --all)

Options:
  --force, -f       Force operations without confirmation
  --do              Execute clean (default is dry run)`)
}

func cmdInit(args []string) {
	cwd, _ := os.Getwd()
	mainRepo, project := detectProject(cwd)

	if mainRepo == "" {
		fmt.Println("Error: not in a git repository")
		os.Exit(1)
	}

	// If running from a worktree, use the main repo
	if mainRepo != cwd {
		fmt.Printf("Note: detected main repo at %s\n", mainRepo)
	}

	// Detect base port from .env files
	basePort := readEnvPort(mainRepo, "PORT")
	if basePort == 0 {
		basePort = 3000 // default
	}

	// Allow override via args
	for _, arg := range args {
		if n, err := strconv.Atoi(arg); err == nil {
			basePort = n
		}
	}

	reg := loadRegistry()

	// Check if already registered
	if existing, ok := reg.Projects[project]; ok {
		fmt.Printf("Project '%s' already registered:\n", project)
		fmt.Printf("  Path: %s\n", existing.Path)
		fmt.Printf("  Port: %d\n", existing.BasePort)
		fmt.Println("\nTo update, edit ~/.config/slots/registry.json")
		return
	}

	// Auto-detect group from path (/Projects/<owner>/<project>)
	groupID := ""
	for _, arg := range args {
		if strings.HasPrefix(arg, "--group=") {
			groupID = strings.TrimPrefix(arg, "--group=")
		}
	}
	if groupID == "" {
		groupID = detectGroupFromPath(mainRepo)
	}

	// Ensure group exists
	if groupID != "" {
		if _, ok := reg.Groups[groupID]; !ok {
			reg.Groups[groupID] = GroupConfig{
				Name:  titleCase(groupID),
				Order: len(reg.Groups) + 1,
			}
			fmt.Printf("Auto-created group: %s (%s)\n", titleCase(groupID), groupID)
		}
	}

	// Register
	reg.Projects[project] = ProjectConfig{
		BasePort: basePort,
		Path:     mainRepo,
		Group:    groupID,
	}
	saveRegistry(reg)

	fmt.Println()
	fmt.Println("════════════════════════════════════════")
	fmt.Printf("✓ Project '%s' registered\n\n", project)
	fmt.Printf("  Path:  %s\n", mainRepo)
	fmt.Printf("  Port:  %d\n", basePort)
	if groupID != "" {
		fmt.Printf("  Group: %s\n", titleCase(groupID))
	}
	fmt.Println()
	fmt.Println("Now you can:")
	fmt.Println("  slot-cli new        Create a slot")
	fmt.Println("  slot-cli list       See status")
}

func resolveSlotName(args []string) string {
	cwd, _ := os.Getwd()
	_, project := detectProject(cwd)
	slotName := filepath.Base(cwd)

	// Check if cwd is already a registered slot
	reg := loadRegistry()
	_, cwdIsSlot := reg.Slots[slotName]

	// Only use args as slot identifier if we're NOT already in a slot dir
	if !cwdIsSlot {
		for _, arg := range args {
			if arg == "--force" || arg == "-f" || strings.HasPrefix(arg, "--") {
				continue
			}
			if n, err := strconv.Atoi(arg); err == nil {
				slotName = fmt.Sprintf("%s-%d", project, n)
			} else {
				slotName = fmt.Sprintf("%s-%s", project, arg)
			}
			break
		}
	}
	return slotName
}

func cmdLock(args []string) {
	slotName := resolveSlotName(args)

	// Collect note from remaining args (skip flags and slot identifier)
	var noteParts []string
	skipNext := false
	for _, arg := range args {
		if skipNext {
			skipNext = false
			continue
		}
		if arg == "--force" || arg == "-f" {
			continue
		}
		// Skip the slot identifier (first non-flag arg)
		if len(noteParts) == 0 {
			// Check if this is a slot identifier
			if _, err := strconv.Atoi(arg); err == nil {
				continue // it's a number, skip
			}
			// Could be a name or the start of the note
			// If slot name was auto-detected from cwd, this is the note
			if filepath.Base(func() string { cwd, _ := os.Getwd(); return cwd }()) == slotName {
				noteParts = append(noteParts, arg)
				continue
			}
			continue
		}
		noteParts = append(noteParts, arg)
	}
	note := strings.Join(noteParts, " ")

	// If no explicit args, everything after "lock" is the note
	if len(args) > 0 {
		// Simple approach: if first arg isn't a number and slot was auto-detected, treat all as note
		cwd, _ := os.Getwd()
		if filepath.Base(cwd) == slotName {
			note = strings.Join(args, " ")
		}
	}

	reg := loadRegistry()
	slot, ok := reg.Slots[slotName]
	if !ok {
		fmt.Printf("Error: slot '%s' not found in registry\n", slotName)
		os.Exit(1)
	}

	slot.Locked = true
	slot.LockNote = note
	reg.Slots[slotName] = slot
	saveRegistry(reg)

	fmt.Printf("✓ Locked '%s'\n", slotName)
	if note != "" {
		fmt.Printf("  Note: %s\n", note)
	}
	fmt.Println("\nThis slot cannot be deleted until unlocked:")
	fmt.Println("  slot-cli unlock")
}

func cmdUnlock(args []string) {
	slotName := resolveSlotName(args)

	reg := loadRegistry()
	slot, ok := reg.Slots[slotName]
	if !ok {
		fmt.Printf("Error: slot '%s' not found in registry\n", slotName)
		os.Exit(1)
	}

	if !slot.Locked {
		fmt.Printf("Slot '%s' is not locked\n", slotName)
		return
	}

	slot.Locked = false
	slot.LockNote = ""
	reg.Slots[slotName] = slot
	saveRegistry(reg)

	fmt.Printf("✓ Unlocked '%s'\n", slotName)
}

func cmdGroup(args []string) {
	if len(args) == 0 {
		args = []string{"list"}
	}

	subcmd := args[0]
	subargs := args[1:]

	switch subcmd {
	case "list", "ls":
		reg := loadRegistry()
		if len(reg.Groups) == 0 {
			fmt.Println("No groups defined.")
			fmt.Println("\nCreate one with: slot-cli group create <id> \"<name>\"")
			return
		}

		// Collect projects per group
		groupProjects := make(map[string][]string)
		ungrouped := []string{}
		for name, proj := range reg.Projects {
			if proj.Group != "" {
				groupProjects[proj.Group] = append(groupProjects[proj.Group], name)
			} else {
				ungrouped = append(ungrouped, name)
			}
		}

		fmt.Println()
		for id, group := range reg.Groups {
			projects := groupProjects[id]
			fmt.Printf("  %s (%s) — %d projects\n", group.Name, id, len(projects))
			for _, p := range projects {
				fmt.Printf("    • %s\n", p)
			}
		}

		if len(ungrouped) > 0 {
			fmt.Printf("\n  Ungrouped — %d projects\n", len(ungrouped))
			for _, p := range ungrouped {
				fmt.Printf("    • %s\n", p)
			}
		}
		fmt.Println()

	case "create":
		if len(subargs) < 2 {
			fmt.Println("Usage: slot-cli group create <id> \"<display name>\"")
			fmt.Println("Example: slot-cli group create edgevanta \"Edgevanta\"")
			os.Exit(1)
		}

		id := subargs[0]
		name := subargs[1]

		reg := loadRegistry()

		// Determine order (next available)
		maxOrder := 0
		for _, g := range reg.Groups {
			if g.Order > maxOrder {
				maxOrder = g.Order
			}
		}

		reg.Groups[id] = GroupConfig{
			Name:  name,
			Order: maxOrder + 1,
		}
		saveRegistry(reg)

		fmt.Printf("✓ Created group '%s' (%s)\n", name, id)

	case "assign":
		if len(subargs) < 2 {
			fmt.Println("Usage: slot-cli group assign <project> <group-id>")
			os.Exit(1)
		}

		projectName := subargs[0]
		groupID := subargs[1]

		reg := loadRegistry()

		proj, ok := reg.Projects[projectName]
		if !ok {
			fmt.Printf("Error: project '%s' not found in registry\n", projectName)
			os.Exit(1)
		}

		if _, ok := reg.Groups[groupID]; !ok {
			fmt.Printf("Error: group '%s' not found\n", groupID)
			fmt.Println("Available groups:")
			for id, g := range reg.Groups {
				fmt.Printf("  %s — %s\n", id, g.Name)
			}
			os.Exit(1)
		}

		proj.Group = groupID
		reg.Projects[projectName] = proj
		saveRegistry(reg)

		fmt.Printf("✓ Assigned '%s' to group '%s'\n", projectName, reg.Groups[groupID].Name)

	default:
		fmt.Println("Usage:")
		fmt.Println("  slot-cli group list                     Show groups")
		fmt.Println("  slot-cli group create <id> \"<name>\"     Create group")
		fmt.Println("  slot-cli group assign <project> <group>  Assign project")
	}
}

// detectGroupFromPath extracts the owner/company folder from a project path.
// For /Users/user/Projects/<owner>/<project>, returns the owner folder name.
func detectGroupFromPath(projectPath string) string {
	// Walk up to find the "Projects" parent
	parts := strings.Split(projectPath, "/")
	for i, part := range parts {
		if part == "Projects" && i+2 < len(parts) {
			return parts[i+1] // The folder right after "Projects"
		}
	}
	return ""
}

// titleCase converts "edgevanta" to "Edgevanta"
func titleCase(s string) string {
	if len(s) == 0 {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func cmdNew(args []string) {
	// Parse slot identifier (number or name)
	slotNum := 0
	slotNameArg := ""

	for _, arg := range args {
		if arg == "--force" || arg == "-f" {
			continue
		}
		// Check if it's a number
		if n, err := strconv.Atoi(arg); err == nil {
			slotNum = n
			break
		} else {
			// It's a name
			slotNameArg = arg
			break
		}
	}

	// Detect project
	cwd, _ := os.Getwd()
	mainRepo, project := detectProject(cwd)

	if mainRepo == "" {
		fmt.Println("Error: not in a git repository")
		os.Exit(1)
	}

	var slotName, slotPath, branchName string

	if slotNameArg != "" {
		// Named slot: project-name, branch: name
		slotName = fmt.Sprintf("%s-%s", project, slotNameArg)
		slotPath = filepath.Join(filepath.Dir(mainRepo), slotName)
		branchName = slotNameArg
	} else {
		// Numbered slot: auto-increment if not provided
		if slotNum == 0 {
			slotNum = findNextSlotNumber(mainRepo, project)
			fmt.Printf("Auto-assigned slot: %d\n", slotNum)
		}
		slotName = fmt.Sprintf("%s-%d", project, slotNum)
		slotPath = filepath.Join(filepath.Dir(mainRepo), slotName)
		branchName = fmt.Sprintf("slot-%d", slotNum)
	}

	// Check if exists
	if _, err := os.Stat(slotPath); err == nil {
		fmt.Printf("Error: Slot %s already exists at %s\n", slotName, slotPath)
		os.Exit(1)
	}

	fmt.Printf("Creating slot: %s\n\n", slotName)

	// Create worktree
	runCmd(mainRepo, "git", "worktree", "add", slotPath, "-b", branchName)
	fmt.Println("✓ Created worktree")

	// Copy gitignored files
	copyGitignored(mainRepo, slotPath)
	fmt.Println("✓ Copied gitignored files")

	// Scan ports from main and update slot (use slotNum for port offset, default to 1 for named)
	portOffset := slotNum
	if portOffset == 0 {
		portOffset = findNextSlotNumber(mainRepo, project)
	}
	portMap := scanAndAllocatePorts(mainRepo, portOffset)
	if len(portMap) > 0 {
		updateSlotEnvFiles(slotPath, portMap, slotName)
		updateConfigFiles(slotPath, portMap)
		updateDockerComposeFiles(slotPath, slotName)
		fmt.Println("✓ Port mapping complete")

		// Start docker and clone database
		startDockerAndClone(mainRepo, slotPath, portMap)
	}

	// Install dependencies
	installDeps(slotPath)

	// Update registry
	updateRegistryFull(slotName, project, slotNum, slotNameArg, branchName)

	// Summary
	fmt.Println("\n════════════════════════════════════════")
	if slotNameArg != "" {
		fmt.Printf("✓ Slot '%s' ready\n\n", slotNameArg)
	} else {
		fmt.Printf("✓ Slot %d ready\n\n", slotNum)
	}
	fmt.Printf("  Path: %s\n", slotPath)
	fmt.Printf("  Branch: %s\n", branchName)
	if len(portMap) > 0 {
		fmt.Println("  Ports:")
		for mainPort, slotPort := range portMap {
			fmt.Printf("    %d → %d\n", mainPort, slotPort)
		}
	}
	fmt.Println()

	// Copy cd command to clipboard
	exec.Command("sh", "-c", fmt.Sprintf("echo 'cd %s' | pbcopy", slotPath)).Run()
	fmt.Println("→ Cmd+T, Cmd+V, Enter")
	fmt.Println("→ Then: slot-cli start")
}

func cmdDelete(args []string) {
	force := false
	slotNum := 0
	slotNameArg := ""

	for _, arg := range args {
		if arg == "--force" || arg == "-f" {
			force = true
		} else if n, err := strconv.Atoi(arg); err == nil {
			slotNum = n
		} else if arg != "" {
			slotNameArg = arg
		}
	}

	if slotNum == 0 && slotNameArg == "" {
		fmt.Println("Error: need slot number or name")
		fmt.Println("Usage: slot-cli delete <number|name> [--force]")
		os.Exit(1)
	}

	cwd, _ := os.Getwd()
	mainRepo, project := detectProject(cwd)

	var slotName, slotPath string
	if slotNameArg != "" {
		slotName = fmt.Sprintf("%s-%s", project, slotNameArg)
	} else {
		slotName = fmt.Sprintf("%s-%d", project, slotNum)
	}
	slotPath = filepath.Join(filepath.Dir(mainRepo), slotName)

	if _, err := os.Stat(slotPath); os.IsNotExist(err) {
		fmt.Printf("Error: Slot %s not found\n", slotName)
		os.Exit(1)
	}

	// Check lock
	reg := loadRegistry()
	if slot, ok := reg.Slots[slotName]; ok && slot.Locked {
		fmt.Printf("Error: Slot '%s' is LOCKED\n", slotName)
		if slot.LockNote != "" {
			fmt.Printf("  Note: %s\n", slot.LockNote)
		}
		fmt.Println("\nUnlock first: slot-cli unlock")
		os.Exit(1)
	}

	// Check for uncommitted changes
	out, _ := exec.Command("git", "-C", slotPath, "status", "--porcelain").Output()
	if len(out) > 0 && !force {
		fmt.Println("Warning: Slot has uncommitted changes")
		fmt.Println("Use --force to delete anyway")
		os.Exit(1)
	}

	// Stop docker
	stopDocker(slotPath)

	// Remove worktree
	branchName := getBranchName(slotPath)
	exec.Command("git", "-C", mainRepo, "worktree", "remove", slotPath, "--force").Run()
	exec.Command("git", "-C", mainRepo, "branch", "-D", branchName).Run()

	// Update registry
	removeFromRegistry(slotName)

	if slotNameArg != "" {
		fmt.Printf("✓ Deleted slot '%s'\n", slotNameArg)
	} else {
		fmt.Printf("✓ Deleted slot %d\n", slotNum)
	}
}

func cmdList() {
	fmt.Println("╔══════════════════════════════════════════════════════════════════╗")
	fmt.Println("║                    CLAUDE INSTANCES                              ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════════╝")
	fmt.Println()

	out, err := exec.Command("pgrep", "-f", "claude").Output()
	if err != nil {
		fmt.Println("No Claude instances running.")
		return
	}

	pids := strings.Fields(string(out))
	for _, pid := range pids {
		info := getClaudeInfo(pid)
		if info != nil {
			fmt.Printf("┌─ %s\n", info["project"])
			fmt.Printf("│  Branch:  %s\n", info["branch"])
			fmt.Printf("│  Session: %s\n", info["session"])
			fmt.Printf("│  Model:   %s\n", info["model"])
			fmt.Printf("│  Runtime: %s\n", info["runtime"])
			fmt.Println("└──────────────────────────────────────")
			fmt.Println()
		}
	}
}

func cmdStart() {
	cmd := exec.Command("bash", "-lc", "claude --dangerously-skip-permissions")
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Run()
}

func cmdContinue() {
	cmd := exec.Command("bash", "-lc", "claude --continue --dangerously-skip-permissions")
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Run()
}

func cmdCheck(args []string) {
	slotNum := 0
	for _, arg := range args {
		if n, err := strconv.Atoi(arg); err == nil {
			slotNum = n
			break
		}
	}

	cwd, _ := os.Getwd()
	if slotNum == 0 {
		// Try to detect from current directory name
		base := filepath.Base(cwd)
		re := regexp.MustCompile(`-(\d+)$`)
		if m := re.FindStringSubmatch(base); len(m) > 1 {
			slotNum, _ = strconv.Atoi(m[1])
		}
	}

	if slotNum == 0 {
		fmt.Println("Error: need slot number or run from slot directory")
		os.Exit(1)
	}

	mainRepo, project := detectProject(cwd)
	slotName := fmt.Sprintf("%s-%d", project, slotNum)
	slotPath := filepath.Join(filepath.Dir(mainRepo), slotName)

	fmt.Println("═══════════════════════════════════════")
	fmt.Printf("  SLOT VALIDATION: %s\n", slotName)
	fmt.Println("═══════════════════════════════════════")
	fmt.Println()

	errors := 0

	// Check directory exists
	if _, err := os.Stat(slotPath); err == nil {
		fmt.Println("✓ Directory exists")
	} else {
		fmt.Println("✗ Directory missing")
		errors++
	}

	// Check is worktree
	gitFile := filepath.Join(slotPath, ".git")
	if info, err := os.Stat(gitFile); err == nil && !info.IsDir() {
		fmt.Println("✓ Is git worktree")
	} else {
		fmt.Println("✗ Not a git worktree")
		errors++
	}

	// Check branch
	branch := getBranchName(slotPath)
	if branch != "" {
		fmt.Printf("✓ Branch: %s\n", branch)
	} else {
		fmt.Println("✗ Could not detect branch")
		errors++
	}

	fmt.Println()
	fmt.Println("═══════════════════════════════════════")
	if errors == 0 {
		fmt.Println("  ✓ ALL CHECKS PASSED")
	} else {
		fmt.Printf("  ✗ %d ISSUES FOUND\n", errors)
	}
	fmt.Println("═══════════════════════════════════════")
}

func cmdSync() {
	cwd, _ := os.Getwd()
	mainRepo, _ := detectProject(cwd)

	if mainRepo == "" {
		fmt.Println("Error: not in a git repository")
		os.Exit(1)
	}

	// Check if we're in a slot (worktree)
	if mainRepo == cwd {
		fmt.Println("Error: already in main worktree, nothing to sync")
		os.Exit(1)
	}

	branch := getBranchName(cwd)
	if branch == "" {
		fmt.Println("Error: could not detect current branch")
		os.Exit(1)
	}

	fmt.Printf("Syncing slot branch '%s' with main...\n\n", branch)

	// Check for uncommitted changes
	out, _ := exec.Command("git", "-C", cwd, "status", "--porcelain").Output()
	if len(out) > 0 {
		fmt.Println("Error: uncommitted changes detected")
		fmt.Println("Please commit or stash your changes before syncing")
		os.Exit(1)
	}

	// Fetch latest from origin
	fmt.Println("Fetching latest from origin...")
	if err := runCmd(cwd, "git", "fetch", "origin", "main:main"); err != nil {
		// Try without the ref update (origin/main might not exist locally)
		runCmd(cwd, "git", "fetch", "origin", "main")
	}
	fmt.Println("✓ Fetched latest main")

	// Check if rebase is needed
	behindOut, _ := exec.Command("git", "-C", cwd, "rev-list", "--count", branch+"..main").Output()
	behind := strings.TrimSpace(string(behindOut))

	aheadOut, _ := exec.Command("git", "-C", cwd, "rev-list", "--count", "main.."+branch).Output()
	ahead := strings.TrimSpace(string(aheadOut))

	fmt.Printf("\nStatus: %s commits ahead, %s commits behind main\n", ahead, behind)

	if behind == "0" {
		fmt.Println("\n✓ Already up to date with main")
		return
	}

	// Perform rebase
	fmt.Println("\nRebasing on main...")
	cmd := exec.Command("git", "-C", cwd, "rebase", "main")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		fmt.Println("\n⚠ Rebase conflict detected!")
		fmt.Println("\nTo resolve:")
		fmt.Println("  1. Fix conflicts in the affected files")
		fmt.Println("  2. git add <fixed files>")
		fmt.Println("  3. git rebase --continue")
		fmt.Println("\nTo abort:")
		fmt.Println("  git rebase --abort")
		os.Exit(1)
	}

	fmt.Println("\n✓ Successfully synced with main")

	// Install dependencies after rebase
	installDeps(cwd)
}

func cmdMerge(args []string) {
	slotNum := 0
	for _, arg := range args {
		if n, err := strconv.Atoi(arg); err == nil {
			slotNum = n
			break
		}
	}

	if slotNum == 0 {
		fmt.Println("Error: need slot number")
		fmt.Println("Usage: slot-cli merge <N>")
		os.Exit(1)
	}

	cwd, _ := os.Getwd()
	mainRepo, _ := detectProject(cwd)

	if mainRepo == "" {
		fmt.Println("Error: not in a git repository")
		os.Exit(1)
	}

	// Must be run from main worktree
	if mainRepo != cwd {
		fmt.Println("Error: must run from main worktree, not from a slot")
		os.Exit(1)
	}

	branchName := fmt.Sprintf("slot-%d", slotNum)

	// Check branch exists
	out, err := exec.Command("git", "-C", mainRepo, "branch", "--list", branchName).Output()
	if err != nil || strings.TrimSpace(string(out)) == "" {
		fmt.Printf("Error: branch '%s' not found\n", branchName)
		os.Exit(1)
	}

	fmt.Printf("Merging %s into main...\n", branchName)

	cmd := exec.Command("git", "-C", mainRepo, "merge", branchName)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		fmt.Println("\n⚠ Merge conflict!")
		fmt.Println("Resolve conflicts, then: git commit")
		os.Exit(1)
	}

	fmt.Printf("\n✓ Merged %s into main\n", branchName)
}

func cmdDone(args []string) {
	force := false
	for _, arg := range args {
		if arg == "--force" || arg == "-f" {
			force = true
		}
	}

	cwd, _ := os.Getwd()
	mainRepo, project := detectProject(cwd)

	if mainRepo == "" {
		fmt.Println("Error: not in a git repository")
		os.Exit(1)
	}

	// Must be run from a slot (worktree), not main
	if mainRepo == cwd {
		fmt.Println("Error: must run from a slot worktree, not main")
		os.Exit(1)
	}

	slotPath := cwd
	branchName := getBranchName(slotPath)
	slotName := filepath.Base(slotPath)

	// Check lock
	reg := loadRegistry()
	if slot, ok := reg.Slots[slotName]; ok && slot.Locked {
		fmt.Printf("Error: Slot '%s' is LOCKED\n", slotName)
		if slot.LockNote != "" {
			fmt.Printf("  Note: %s\n", slot.LockNote)
		}
		fmt.Println("\nUnlock first: slot-cli unlock")
		os.Exit(1)
	}
	_ = project // used later

	fmt.Printf("Completing slot: %s\n\n", slotName)

	// Check for uncommitted changes
	out, _ := exec.Command("git", "-C", slotPath, "status", "--porcelain").Output()
	if len(out) > 0 && !force {
		fmt.Println("Error: uncommitted changes detected")
		fmt.Println("Commit your changes or use --force to skip")
		os.Exit(1)
	}

	// Stop docker first
	fmt.Println("Stopping docker...")
	stopDocker(slotPath)
	fmt.Println("✓ Docker stopped")

	// Go to main and merge
	fmt.Printf("\nMerging %s into main...\n", branchName)
	cmd := exec.Command("git", "-C", mainRepo, "merge", branchName)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		fmt.Println("\n⚠ Merge conflict!")
		fmt.Println("Resolve conflicts in main, then manually delete slot:")
		fmt.Printf("  cd %s\n", mainRepo)
		fmt.Println("  git commit")
		fmt.Printf("  slot-cli delete %s\n", extractSlotIdentifier(slotName, project))
		os.Exit(1)
	}
	fmt.Printf("✓ Merged %s into main\n", branchName)

	// Remove worktree and branch
	fmt.Println("\nCleaning up...")
	exec.Command("git", "-C", mainRepo, "worktree", "remove", slotPath, "--force").Run()
	exec.Command("git", "-C", mainRepo, "branch", "-D", branchName).Run()
	fmt.Println("✓ Removed worktree and branch")

	// Update registry
	removeFromRegistry(slotName)

	fmt.Printf("\n✓ Slot done! Now in main with merged changes.\n")
	fmt.Printf("\n  cd %s\n", mainRepo)
}

func cmdPR(args []string) {
	cwd, _ := os.Getwd()
	mainRepo, _ := detectProject(cwd)

	if mainRepo == "" {
		fmt.Println("Error: not in a git repository")
		os.Exit(1)
	}

	// Can run from slot or detect slot from args
	slotPath := cwd
	if mainRepo == cwd {
		fmt.Println("Error: must run from a slot worktree")
		os.Exit(1)
	}

	branchName := getBranchName(slotPath)
	if branchName == "" {
		fmt.Println("Error: could not detect branch")
		os.Exit(1)
	}

	fmt.Printf("Creating PR for branch: %s\n\n", branchName)

	// Push to origin with upstream tracking
	fmt.Println("Pushing to origin...")
	cmd := exec.Command("git", "-C", slotPath, "push", "-u", "origin", branchName)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Println("Error: failed to push")
		os.Exit(1)
	}
	fmt.Println("✓ Pushed to origin")

	// Create PR using gh
	fmt.Println("\nCreating PR...")
	cmd = exec.Command("gh", "pr", "create", "--fill")
	cmd.Dir = slotPath
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Println("\n⚠ PR creation failed (may already exist)")
		fmt.Println("View existing PRs: gh pr list")
	}
}

func cmdClean(args []string) {
	doClean := false
	force := false

	for _, arg := range args {
		if arg == "--do" {
			doClean = true
		} else if arg == "--force" || arg == "-f" {
			force = true
		}
	}

	fmt.Println()
	fmt.Println("════════════════════════════════════════════════════════════════")
	fmt.Println("                        SLOT CLEAN")
	fmt.Println("════════════════════════════════════════════════════════════════")
	fmt.Println()

	cwd, _ := os.Getwd()
	mainRepo, _ := detectProject(cwd)
	if mainRepo == "" {
		mainRepo = cwd
	}
	parentDir := filepath.Dir(mainRepo)

	reg := loadRegistry()

	var safeTmux []string
	var safeWorktrees []string
	var blockedItems []string
	var warningItems []string

	// 1. Check tmux sessions
	fmt.Println("Scanning tmux sessions...")
	out, _ := exec.Command("tmux", "list-sessions", "-F", "#{session_name}").Output()
	sessions := strings.Split(strings.TrimSpace(string(out)), "\n")

	for _, session := range sessions {
		if session == "" {
			continue
		}
		// Check if Claude is running in this session
		paneOut, _ := exec.Command("tmux", "list-panes", "-t", session, "-F", "#{pane_current_command}").Output()
		if strings.Contains(strings.ToLower(string(paneOut)), "claude") {
			blockedItems = append(blockedItems, fmt.Sprintf("tmux:%s - Claude running", session))
		} else {
			safeTmux = append(safeTmux, session)
			fmt.Printf("  ✓ tmux:%s - safe to kill\n", session)
		}
	}
	if len(sessions) == 0 || (len(sessions) == 1 && sessions[0] == "") {
		fmt.Println("  (no tmux sessions)")
	}

	fmt.Println()

	// 2. Check git worktrees
	fmt.Println("Scanning worktrees...")
	entries, _ := os.ReadDir(parentDir)

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		wtPath := filepath.Join(parentDir, entry.Name())

		// Skip if it's the main repo
		if wtPath == mainRepo {
			continue
		}

		// Check if it's a slot/worktree pattern
		if !strings.Contains(entry.Name(), "-") {
			continue
		}

		// Check if it's a git worktree
		gitFile := filepath.Join(wtPath, ".git")
		info, err := os.Stat(gitFile)
		if err != nil || info.IsDir() {
			continue
		}

		branch := getBranchName(wtPath)

		// Check 1: Uncommitted changes
		uncommittedOut, _ := exec.Command("git", "-C", wtPath, "status", "--porcelain").Output()
		uncommitted := len(strings.TrimSpace(string(uncommittedOut))) > 0

		// Check 2: Unpushed commits
		unpushedOut, _ := exec.Command("git", "-C", wtPath, "log", "origin/"+branch+"..HEAD", "--oneline").Output()
		unpushed := len(strings.TrimSpace(string(unpushedOut))) > 0

		// Check 3: Unmerged with main
		unmergedOut, _ := exec.Command("git", "-C", wtPath, "log", "origin/main..HEAD", "--oneline").Output()
		if len(unmergedOut) == 0 {
			unmergedOut, _ = exec.Command("git", "-C", wtPath, "log", "origin/master..HEAD", "--oneline").Output()
		}
		unmergedCount := 0
		if len(strings.TrimSpace(string(unmergedOut))) > 0 {
			unmergedCount = len(strings.Split(strings.TrimSpace(string(unmergedOut)), "\n"))
		}

		wtName := entry.Name()

		// Check lock
		if slot, ok := reg.Slots[wtName]; ok && slot.Locked {
			note := ""
			if slot.LockNote != "" {
				note = " — " + slot.LockNote
			}
			blockedItems = append(blockedItems, fmt.Sprintf("%s (%s) - LOCKED%s", wtName, branch, note))
			continue
		}

		if uncommitted {
			blockedItems = append(blockedItems, fmt.Sprintf("%s (%s) - DIRTY: uncommitted files", wtName, branch))
		} else if unpushed {
			blockedItems = append(blockedItems, fmt.Sprintf("%s (%s) - UNPUSHED: commits not on remote", wtName, branch))
		} else if unmergedCount > 0 {
			warningItems = append(warningItems, fmt.Sprintf("%s (%s) - UNMERGED: %d commits not in main", wtName, branch, unmergedCount))
			if force {
				safeWorktrees = append(safeWorktrees, wtPath)
			}
		} else {
			safeWorktrees = append(safeWorktrees, wtPath)
			fmt.Printf("  ✓ %s (%s) - CLEAN: merged to main\n", wtName, branch)
		}
	}

	if len(safeWorktrees) == 0 && len(blockedItems) == 0 && len(warningItems) == 0 {
		fmt.Println("  (no worktrees found)")
	}

	fmt.Println()

	// 3. Check for orphan registry entries (slot in registry but no directory on disk)
	var orphanSlots []string
	fmt.Println("Scanning registry for orphans...")
	for slotName, slotCfg := range reg.Slots {
		projectCfg, ok := reg.Projects[slotCfg.Project]
		if !ok {
			orphanSlots = append(orphanSlots, slotName)
			fmt.Printf("  ✗ %s - ORPHAN: project '%s' not in registry\n", slotName, slotCfg.Project)
			continue
		}
		slotDir := filepath.Join(filepath.Dir(projectCfg.Path), slotName)
		if _, err := os.Stat(slotDir); os.IsNotExist(err) {
			orphanSlots = append(orphanSlots, slotName)
			fmt.Printf("  ✗ %s - ORPHAN: directory not found (%s)\n", slotName, slotDir)
		}
	}
	if len(orphanSlots) == 0 {
		fmt.Println("  (no orphans)")
	}

	fmt.Println()

	// 4. Summary
	fmt.Println("════════════════════════════════════════════════════════════════")

	if len(blockedItems) > 0 {
		fmt.Println("\033[31mBLOCKED - cannot clean:\033[0m")
		for _, item := range blockedItems {
			fmt.Printf("  ✗ %s\n", item)
		}
		fmt.Println()
	}

	if len(warningItems) > 0 {
		fmt.Println("\033[33mWARNINGS - unmerged branches:\033[0m")
		for _, item := range warningItems {
			fmt.Printf("  ⚠ %s\n", item)
		}
		fmt.Println("  (use --force to include these)")
		fmt.Println()
	}

	if len(orphanSlots) > 0 {
		fmt.Println("\033[35mORPHAN REGISTRY ENTRIES:\033[0m")
		for _, name := range orphanSlots {
			fmt.Printf("  ✗ %s\n", name)
		}
		fmt.Println()
	}

	safeCount := len(safeTmux) + len(safeWorktrees) + len(orphanSlots)

	if safeCount == 0 {
		fmt.Println("\033[36mNothing safe to clean.\033[0m")
		return
	}

	fmt.Printf("\033[32mSAFE TO CLEAN: %d items\033[0m\n", safeCount)

	if !doClean {
		fmt.Println()
		fmt.Println("This is a dry run. To actually clean, run:")
		fmt.Println("  slot-cli clean --do")
		if len(warningItems) > 0 {
			fmt.Println("  slot-cli clean --do --force  (include unmerged branches)")
		}
		return
	}

	// Actually clean
	fmt.Println()
	fmt.Println("\033[36mCleaning...\033[0m")

	// Kill tmux sessions
	for _, session := range safeTmux {
		if err := exec.Command("tmux", "kill-session", "-t", session).Run(); err == nil {
			fmt.Printf("  ✓ Killed tmux:%s\n", session)
		}
	}

	// Remove orphan registry entries
	for _, slotName := range orphanSlots {
		removeFromRegistry(slotName)
		fmt.Printf("  ✓ Removed orphan registry entry: %s\n", slotName)
	}

	// Remove worktrees
	for _, wtPath := range safeWorktrees {
		wtName := filepath.Base(wtPath)
		branch := getBranchName(wtPath)

		// Stop docker if running
		stopDocker(wtPath)

		// Find main repo
		gitContent, err := os.ReadFile(filepath.Join(wtPath, ".git"))
		if err != nil {
			continue
		}
		line := strings.TrimSpace(string(gitContent))
		if !strings.HasPrefix(line, "gitdir:") {
			continue
		}
		gitdir := strings.TrimSpace(strings.TrimPrefix(line, "gitdir:"))
		idx := strings.Index(gitdir, "/.git/worktrees")
		if idx < 0 {
			continue
		}
		wtMainRepo := gitdir[:idx]

		// Remove worktree and branch
		exec.Command("git", "-C", wtMainRepo, "worktree", "remove", wtPath, "--force").Run()
		exec.Command("git", "-C", wtMainRepo, "branch", "-D", branch).Run()
		removeFromRegistry(wtName)
		fmt.Printf("  ✓ Removed worktree: %s\n", wtName)
	}

	fmt.Println()
	fmt.Println("\033[32mDone!\033[0m")
}

type ClaudeProcess struct {
	PID     int
	CWD     string
	Project string
	Branch  string
	Runtime string
}

func getClaudeProcesses() []ClaudeProcess {
	out, err := exec.Command("pgrep", "-f", "claude").Output()
	if err != nil {
		return nil
	}

	seen := make(map[string]bool) // dedupe by cwd
	var processes []ClaudeProcess

	for _, pidStr := range strings.Fields(string(out)) {
		pid, _ := strconv.Atoi(pidStr)
		if pid == 0 {
			continue
		}

		// Get cwd
		lsofOut, err := exec.Command("bash", "-c", fmt.Sprintf("lsof -p %d 2>/dev/null | grep cwd | awk '{print $NF}'", pid)).Output()
		if err != nil {
			continue
		}
		cwd := strings.TrimSpace(string(lsofOut))
		if cwd == "" || cwd == "/" || !strings.HasPrefix(cwd, "/Users") {
			continue
		}

		if seen[cwd] {
			continue
		}
		seen[cwd] = true

		// Get branch
		branchOut, _ := exec.Command("git", "-C", cwd, "branch", "--show-current").Output()
		branch := strings.TrimSpace(string(branchOut))

		// Get runtime
		runtimeOut, _ := exec.Command("ps", "-p", pidStr, "-o", "etime=").Output()
		runtime := strings.TrimSpace(string(runtimeOut))

		// Extract project name from path
		project := filepath.Base(cwd)

		processes = append(processes, ClaudeProcess{
			PID:     pid,
			CWD:     cwd,
			Project: project,
			Branch:  branch,
			Runtime: runtime,
		})
	}
	return processes
}

func cmdCleanClaude(args []string) {
	killOrphans := false
	killAll := false
	dryRun := true

	for _, arg := range args {
		if arg == "--orphans" {
			killOrphans = true
			dryRun = false
		} else if arg == "--all" {
			killAll = true
			dryRun = false
		}
	}

	fmt.Println()
	fmt.Println("════════════════════════════════════════════════════════════════")
	fmt.Println("                     CLAUDE CLEANUP")
	fmt.Println("════════════════════════════════════════════════════════════════")
	fmt.Println()

	processes := getClaudeProcesses()
	if len(processes) == 0 {
		fmt.Println("No Claude instances running.")
		return
	}

	registry := loadRegistry()

	// Build set of known paths from registry
	knownPaths := make(map[string]string) // path -> label
	for name, project := range registry.Projects {
		knownPaths[project.Path] = name + " (main)"
	}
	for name, slot := range registry.Slots {
		project := registry.Projects[slot.Project]
		if project.Path != "" {
			slotPath := filepath.Join(filepath.Dir(project.Path), name)
			knownPaths[slotPath] = name + " (" + slot.Branch + ")"
		}
	}

	var attached []ClaudeProcess
	var orphans []ClaudeProcess

	for _, p := range processes {
		matched := false
		for knownPath, label := range knownPaths {
			if p.CWD == knownPath || strings.HasPrefix(p.CWD, knownPath+"/") {
				p.Project = label
				attached = append(attached, p)
				matched = true
				break
			}
		}
		if !matched {
			orphans = append(orphans, p)
		}
	}

	fmt.Printf("\033[32mATTACHED TO SLOTS (%d):\033[0m\n", len(attached))
	for _, p := range attached {
		fmt.Printf("  • pid %d  %s  branch:%s  %s\n", p.PID, p.Project, p.Branch, p.Runtime)
	}
	if len(attached) == 0 {
		fmt.Println("  (none)")
	}
	fmt.Println()

	fmt.Printf("\033[33mUNREGISTERED (%d):\033[0m\n", len(orphans))
	for _, p := range orphans {
		fmt.Printf("  • pid %d  %s  branch:%s  %s\n", p.PID, p.Project, p.Branch, p.Runtime)
	}
	if len(orphans) == 0 {
		fmt.Println("  (none)")
	}
	fmt.Println()

	fmt.Println("════════════════════════════════════════════════════════════════")

	if dryRun {
		fmt.Println("This is a dry run. To stop instances:")
		fmt.Println("  slot-cli clean claude --orphans  (stop unregistered only)")
		fmt.Println("  slot-cli clean claude --all      (stop all claude instances)")
		return
	}

	var toKill []ClaudeProcess
	if killAll {
		toKill = processes
		fmt.Printf("\n\033[36mStopping ALL %d claude instances...\033[0m\n", len(toKill))
	} else if killOrphans {
		toKill = orphans
		fmt.Printf("\n\033[36mStopping %d unregistered claude instances...\033[0m\n", len(toKill))
	}

	for _, p := range toKill {
		if err := exec.Command("kill", strconv.Itoa(p.PID)).Run(); err == nil {
			fmt.Printf("  ✓ Stopped %s (pid %d)\n", p.Project, p.PID)
		} else {
			fmt.Printf("  ✗ Failed to stop %s (pid %d)\n", p.Project, p.PID)
		}
	}

	fmt.Println()
	fmt.Println("\033[32mDone!\033[0m")
}

type DockerProcess struct {
	Name    string
	Ports   string
	Status  string
	Image   string
	Project string // matched project/slot from registry
}

func getDockerProcesses() []DockerProcess {
	out, err := exec.Command("docker", "ps", "--format", "{{.Names}}|{{.Ports}}|{{.Status}}|{{.Image}}").Output()
	if err != nil {
		return nil
	}

	var processes []DockerProcess
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 4)
		if len(parts) < 4 {
			continue
		}
		processes = append(processes, DockerProcess{
			Name:   parts[0],
			Ports:  parts[1],
			Status: parts[2],
			Image:  parts[3],
		})
	}
	return processes
}

func cmdCleanDocker(args []string) {
	killOrphans := false
	killAll := false
	dryRun := true

	for _, arg := range args {
		if arg == "--orphans" {
			killOrphans = true
			dryRun = false
		} else if arg == "--all" {
			killAll = true
			dryRun = false
		}
	}

	fmt.Println()
	fmt.Println("════════════════════════════════════════════════════════════════")
	fmt.Println("                     DOCKER CLEANUP")
	fmt.Println("════════════════════════════════════════════════════════════════")
	fmt.Println()

	processes := getDockerProcesses()
	if len(processes) == 0 {
		fmt.Println("No docker containers running.")
		return
	}

	registry := loadRegistry()

	// Build set of known prefixes from registry (projects + slots)
	knownPrefixes := make(map[string]string) // prefix -> label
	for name := range registry.Projects {
		knownPrefixes[name] = name + " (main)"
	}
	for name, slot := range registry.Slots {
		knownPrefixes[name] = name + " (" + slot.Branch + ")"
	}

	var attached []DockerProcess
	var orphans []DockerProcess

	for _, p := range processes {
		matched := false
		for prefix, label := range knownPrefixes {
			if strings.HasPrefix(p.Name, prefix+"-") || p.Name == prefix {
				p.Project = label
				attached = append(attached, p)
				matched = true
				break
			}
		}
		if !matched {
			orphans = append(orphans, p)
		}
	}

	fmt.Printf("\033[32mATTACHED TO SLOTS (%d):\033[0m\n", len(attached))
	for _, p := range attached {
		fmt.Printf("  • %s → %s\n", p.Name, p.Project)
	}
	if len(attached) == 0 {
		fmt.Println("  (none)")
	}
	fmt.Println()

	fmt.Printf("\033[33mORPHAN CONTAINERS (%d):\033[0m\n", len(orphans))
	for _, p := range orphans {
		fmt.Printf("  • %s (%s)\n", p.Name, p.Image)
	}
	if len(orphans) == 0 {
		fmt.Println("  (none)")
	}
	fmt.Println()

	fmt.Println("════════════════════════════════════════════════════════════════")

	if dryRun {
		fmt.Println("This is a dry run. To stop containers:")
		fmt.Println("  slot-cli clean docker --orphans  (stop orphans only)")
		fmt.Println("  slot-cli clean docker --all      (stop all containers)")
		fmt.Println()
		fmt.Println("Note: volumes are preserved (no -v flag).")
		return
	}

	var toStop []DockerProcess
	if killAll {
		toStop = processes
		fmt.Printf("\n\033[36mStopping ALL %d containers...\033[0m\n", len(toStop))
	} else if killOrphans {
		toStop = orphans
		fmt.Printf("\n\033[36mStopping %d orphan containers...\033[0m\n", len(toStop))
	}

	for _, p := range toStop {
		if err := exec.Command("docker", "stop", p.Name).Run(); err == nil {
			fmt.Printf("  ✓ Stopped %s\n", p.Name)
		} else {
			fmt.Printf("  ✗ Failed to stop %s\n", p.Name)
		}
	}

	fmt.Println()
	fmt.Println("\033[32mDone! (volumes preserved)\033[0m")
}

type StorybookProcess struct {
	PID     int
	Port    int
	Project string
	CWD     string
}

func getStorybookProcesses() []StorybookProcess {
	out, err := exec.Command("bash", "-c", `ps aux | grep "storybook/dist/bin/dispatcher.js" | grep -v grep`).Output()
	if err != nil {
		return nil
	}

	var processes []StorybookProcess
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pid, _ := strconv.Atoi(fields[1])

		// Find -p PORT
		port := 6006
		for i, f := range fields {
			if f == "-p" && i+1 < len(fields) {
				port, _ = strconv.Atoi(fields[i+1])
				break
			}
		}

		// Extract project from path
		re := regexp.MustCompile(`/Projects/[^/]+/([^/]+)`)
		matches := re.FindStringSubmatch(line)
		project := "unknown"
		if len(matches) > 1 {
			project = matches[1]
		}

		// Extract cwd
		cwdRe := regexp.MustCompile(`(/Users/[^\s]+)/node_modules`)
		cwdMatches := cwdRe.FindStringSubmatch(line)
		cwd := ""
		if len(cwdMatches) > 1 {
			cwd = strings.Replace(cwdMatches[1], "/apps/web", "", 1)
		}

		processes = append(processes, StorybookProcess{
			PID:     pid,
			Port:    port,
			Project: project,
			CWD:     cwd,
		})
	}
	return processes
}

func getConfiguredStorybookPorts() map[int]string {
	ports := make(map[int]string)
	registry := loadRegistry()

	for name, project := range registry.Projects {
		// Read from main project
		port := readEnvPort(project.Path, "STORYBOOK_PORT")
		if port > 0 {
			ports[port] = name
		}
	}

	for name, slot := range registry.Slots {
		project := registry.Projects[slot.Project]
		if project.Path == "" {
			continue
		}
		slotPath := filepath.Join(filepath.Dir(project.Path), name)
		port := readEnvPort(slotPath, "STORYBOOK_PORT")
		if port > 0 {
			ports[port] = name
		}
	}

	return ports
}

func readEnvPort(basePath, varName string) int {
	subdirs := []string{"", "apps/web", "packages/ui"}
	envFiles := []string{".env.local", ".env"}

	for _, subdir := range subdirs {
		for _, envFile := range envFiles {
			path := filepath.Join(basePath, subdir, envFile)
			content, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			re := regexp.MustCompile(varName + `=["']?(\d+)["']?`)
			matches := re.FindSubmatch(content)
			if len(matches) > 1 {
				port, _ := strconv.Atoi(string(matches[1]))
				return port
			}
		}
	}
	return 0
}

func cmdCleanStorybook(args []string) {
	killOrphans := false
	killAll := false
	dryRun := true

	for _, arg := range args {
		if arg == "--orphans" {
			killOrphans = true
			dryRun = false
		} else if arg == "--all" {
			killAll = true
			dryRun = false
		}
	}

	fmt.Println()
	fmt.Println("════════════════════════════════════════════════════════════════")
	fmt.Println("                     STORYBOOK CLEANUP")
	fmt.Println("════════════════════════════════════════════════════════════════")
	fmt.Println()

	processes := getStorybookProcesses()
	if len(processes) == 0 {
		fmt.Println("No storybook processes running.")
		return
	}

	configuredPorts := getConfiguredStorybookPorts()

	var attached []StorybookProcess
	var orphans []StorybookProcess

	for _, p := range processes {
		if _, ok := configuredPorts[p.Port]; ok {
			attached = append(attached, p)
		} else {
			orphans = append(orphans, p)
		}
	}

	// Show attached
	fmt.Printf("\033[32mATTACHED TO SLOTS (%d):\033[0m\n", len(attached))
	for _, p := range attached {
		slot := configuredPorts[p.Port]
		fmt.Printf("  • %s :%d (pid %d) → %s\n", p.Project, p.Port, p.PID, slot)
	}
	if len(attached) == 0 {
		fmt.Println("  (none)")
	}
	fmt.Println()

	// Show orphans
	fmt.Printf("\033[33mORPHAN STORYBOOKS (%d):\033[0m\n", len(orphans))
	for _, p := range orphans {
		fmt.Printf("  • %s :%d (pid %d)\n", p.Project, p.Port, p.PID)
	}
	if len(orphans) == 0 {
		fmt.Println("  (none)")
	}
	fmt.Println()

	fmt.Println("════════════════════════════════════════════════════════════════")

	if dryRun {
		fmt.Println("This is a dry run. To kill processes:")
		fmt.Println("  slot-cli clean storybook --orphans  (kill orphans only)")
		fmt.Println("  slot-cli clean storybook --all      (kill all storybooks)")
		return
	}

	var toKill []StorybookProcess
	if killAll {
		toKill = processes
		fmt.Printf("\n\033[36mKilling ALL %d storybooks...\033[0m\n", len(toKill))
	} else if killOrphans {
		toKill = orphans
		fmt.Printf("\n\033[36mKilling %d orphan storybooks...\033[0m\n", len(toKill))
	}

	for _, p := range toKill {
		if err := exec.Command("kill", strconv.Itoa(p.PID)).Run(); err == nil {
			fmt.Printf("  ✓ Killed %s :%d (pid %d)\n", p.Project, p.Port, p.PID)
		} else {
			fmt.Printf("  ✗ Failed to kill %s :%d (pid %d)\n", p.Project, p.Port, p.PID)
		}
	}

	fmt.Println()
	fmt.Println("\033[32mDone!\033[0m")
}

type WebServerProcess struct {
	PID     int
	Port    int
	Project string
	CWD     string
}

func getWebServerProcesses() []WebServerProcess {
	// Look for Next.js dev servers (the main worker process)
	out, err := exec.Command("bash", "-c", `ps aux | grep -E "next-server|next dev" | grep -v grep`).Output()
	if err != nil {
		return nil
	}

	var processes []WebServerProcess
	seen := make(map[int]bool)

	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pid, _ := strconv.Atoi(fields[1])
		if seen[pid] {
			continue
		}
		seen[pid] = true

		// Find -p PORT or --port PORT
		port := 3000
		for i, f := range fields {
			if (f == "-p" || f == "--port") && i+1 < len(fields) {
				p, err := strconv.Atoi(fields[i+1])
				if err == nil {
					port = p
				}
				break
			}
		}

		// Extract project from path
		re := regexp.MustCompile(`/Projects/[^/]+/([^/]+)`)
		matches := re.FindStringSubmatch(line)
		project := "unknown"
		if len(matches) > 1 {
			project = matches[1]
		}

		// Extract cwd
		cwdRe := regexp.MustCompile(`(/Users/[^\s]+)`)
		cwdMatches := cwdRe.FindStringSubmatch(line)
		cwd := ""
		if len(cwdMatches) > 1 {
			cwd = cwdMatches[1]
		}

		processes = append(processes, WebServerProcess{
			PID:     pid,
			Port:    port,
			Project: project,
			CWD:     cwd,
		})
	}
	return processes
}

func cmdCleanWeb(args []string) {
	killOrphans := false
	killAll := false
	dryRun := true

	for _, arg := range args {
		if arg == "--orphans" {
			killOrphans = true
			dryRun = false
		} else if arg == "--all" {
			killAll = true
			dryRun = false
		}
	}

	fmt.Println()
	fmt.Println("════════════════════════════════════════════════════════════════")
	fmt.Println("                     WEB SERVER CLEANUP")
	fmt.Println("════════════════════════════════════════════════════════════════")
	fmt.Println()

	processes := getWebServerProcesses()
	if len(processes) == 0 {
		fmt.Println("No web server processes running.")
		return
	}

	configuredPorts := make(map[int]string)
	registry := loadRegistry()
	for name, project := range registry.Projects {
		port := readEnvPort(project.Path, "PORT")
		if port > 0 {
			configuredPorts[port] = name
		}
	}
	for name, slot := range registry.Slots {
		project := registry.Projects[slot.Project]
		if project.Path == "" {
			continue
		}
		slotPath := filepath.Join(filepath.Dir(project.Path), name)
		port := readEnvPort(slotPath, "PORT")
		if port > 0 {
			configuredPorts[port] = name
		}
	}

	var attached []WebServerProcess
	var orphans []WebServerProcess

	for _, p := range processes {
		if _, ok := configuredPorts[p.Port]; ok {
			attached = append(attached, p)
		} else {
			orphans = append(orphans, p)
		}
	}

	fmt.Printf("\033[32mATTACHED TO SLOTS (%d):\033[0m\n", len(attached))
	for _, p := range attached {
		slot := configuredPorts[p.Port]
		fmt.Printf("  • %s :%d (pid %d) → %s\n", p.Project, p.Port, p.PID, slot)
	}
	if len(attached) == 0 {
		fmt.Println("  (none)")
	}
	fmt.Println()

	fmt.Printf("\033[33mORPHAN WEB SERVERS (%d):\033[0m\n", len(orphans))
	for _, p := range orphans {
		fmt.Printf("  • %s :%d (pid %d)\n", p.Project, p.Port, p.PID)
	}
	if len(orphans) == 0 {
		fmt.Println("  (none)")
	}
	fmt.Println()

	fmt.Println("════════════════════════════════════════════════════════════════")

	if dryRun {
		fmt.Println("This is a dry run. To kill processes:")
		fmt.Println("  slot-cli clean web --orphans  (kill orphans only)")
		fmt.Println("  slot-cli clean web --all      (kill all web servers)")
		return
	}

	var toKill []WebServerProcess
	if killAll {
		toKill = processes
		fmt.Printf("\n\033[36mKilling ALL %d web servers...\033[0m\n", len(toKill))
	} else if killOrphans {
		toKill = orphans
		fmt.Printf("\n\033[36mKilling %d orphan web servers...\033[0m\n", len(toKill))
	}

	skipped := 0
	for _, p := range toKill {
		// Never kill the exceder dashboard
		if p.Project == "exceder" || (p.CWD != "" && strings.Contains(p.CWD, "exceder")) {
			fmt.Printf("  ⊘ Skipped %s :%d (pid %d) — exceder dashboard\n", p.Project, p.Port, p.PID)
			skipped++
			continue
		}
		if err := exec.Command("kill", strconv.Itoa(p.PID)).Run(); err == nil {
			fmt.Printf("  ✓ Killed %s :%d (pid %d)\n", p.Project, p.Port, p.PID)
		} else {
			fmt.Printf("  ✗ Failed to kill %s :%d (pid %d)\n", p.Project, p.Port, p.PID)
		}
	}

	if skipped > 0 {
		fmt.Printf("\n\033[36m(%d exceder processes skipped)\033[0m\n", skipped)
	}
	fmt.Println()
	fmt.Println("\033[32mDone!\033[0m")
}

func cmdVerify() {
	cwd, _ := os.Getwd()
	mainRepo, project := detectProject(cwd)

	if mainRepo == "" {
		fmt.Println("Error: not in a git repository")
		os.Exit(1)
	}

	// Must be run from slot (worktree)
	if mainRepo == cwd {
		fmt.Println("Error: must run from a slot worktree, not main")
		os.Exit(1)
	}

	slotPath := cwd

	// Extract slot number from directory name
	base := filepath.Base(slotPath)
	re := regexp.MustCompile(`-(\d+)$`)
	m := re.FindStringSubmatch(base)
	if len(m) < 2 {
		fmt.Println("Error: could not detect slot number from directory name")
		os.Exit(1)
	}
	slotNum, _ := strconv.Atoi(m[1])
	slotName := fmt.Sprintf("%s-%d", project, slotNum)

	fmt.Println("═══════════════════════════════════════════════════════════")
	fmt.Printf("  SLOT VERIFICATION: %s\n", slotName)
	fmt.Println("═══════════════════════════════════════════════════════════")
	fmt.Println()

	errors := 0
	warnings := 0

	// 1. Check worktree linkage
	fmt.Println("┌─ Worktree Linkage")
	gitFile := filepath.Join(slotPath, ".git")
	if info, err := os.Stat(gitFile); err == nil && !info.IsDir() {
		content, _ := os.ReadFile(gitFile)
		line := strings.TrimSpace(string(content))
		if strings.HasPrefix(line, "gitdir:") {
			gitdir := strings.TrimSpace(strings.TrimPrefix(line, "gitdir:"))
			if strings.Contains(gitdir, mainRepo) {
				fmt.Printf("│  ✓ Linked to main: %s\n", mainRepo)
			} else {
				fmt.Printf("│  ✗ Linked to unexpected repo: %s\n", gitdir)
				errors++
			}
		}
	} else {
		fmt.Println("│  ✗ Not a valid worktree (.git file missing)")
		errors++
	}
	fmt.Println("└──────────────────────────────────────")
	fmt.Println()

	// 2. Check branch relationship
	fmt.Println("┌─ Branch & History")
	slotBranch := getBranchName(slotPath)
	mainBranch := getBranchName(mainRepo)
	fmt.Printf("│  Slot branch:  %s\n", slotBranch)
	fmt.Printf("│  Main branch:  %s\n", mainBranch)

	// Check if branches share history (merge base exists)
	mergeBase, err := exec.Command("git", "-C", slotPath, "merge-base", slotBranch, mainBranch).Output()
	if err != nil || len(mergeBase) == 0 {
		fmt.Println("│  ✗ No common ancestor with main")
		errors++
	} else {
		fmt.Printf("│  ✓ Common ancestor: %s\n", strings.TrimSpace(string(mergeBase))[:7])

		// Check commits ahead/behind
		behindOut, _ := exec.Command("git", "-C", slotPath, "rev-list", "--count", slotBranch+".."+mainBranch).Output()
		aheadOut, _ := exec.Command("git", "-C", slotPath, "rev-list", "--count", mainBranch+".."+slotBranch).Output()
		behind := strings.TrimSpace(string(behindOut))
		ahead := strings.TrimSpace(string(aheadOut))
		fmt.Printf("│  ✓ %s ahead, %s behind main\n", ahead, behind)

		if behind != "0" {
			fmt.Println("│  ⚠ Consider running 'slot-cli sync' to update")
			warnings++
		}
	}
	fmt.Println("└──────────────────────────────────────")
	fmt.Println()

	// 3. Check registry
	fmt.Println("┌─ Registry")
	reg := loadRegistry()
	if slot, exists := reg.Slots[slotName]; exists {
		fmt.Printf("│  ✓ Registry entry exists\n")
		if slot.Project == project {
			fmt.Printf("│  ✓ Project matches: %s\n", slot.Project)
		} else {
			fmt.Printf("│  ✗ Project mismatch: registry=%s, detected=%s\n", slot.Project, project)
			errors++
		}
		if slot.Number == slotNum {
			fmt.Printf("│  ✓ Slot number matches: %d\n", slot.Number)
		} else {
			fmt.Printf("│  ✗ Slot number mismatch: registry=%d, detected=%d\n", slot.Number, slotNum)
			errors++
		}
		if slot.Branch == slotBranch {
			fmt.Printf("│  ✓ Branch matches: %s\n", slot.Branch)
		} else {
			fmt.Printf("│  ✗ Branch mismatch: registry=%s, actual=%s\n", slot.Branch, slotBranch)
			errors++
		}
		fmt.Printf("│  Created: %s\n", slot.CreatedAt)
	} else {
		fmt.Println("│  ⚠ No registry entry (slot may have been created manually)")
		warnings++
	}
	fmt.Println("└──────────────────────────────────────")
	fmt.Println()

	// 4. Check uncommitted changes
	fmt.Println("┌─ Working Tree")
	out, _ := exec.Command("git", "-C", slotPath, "status", "--porcelain").Output()
	if len(out) == 0 {
		fmt.Println("│  ✓ Clean working tree")
	} else {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		fmt.Printf("│  ⚠ %d uncommitted changes\n", len(lines))
		warnings++
	}
	fmt.Println("└──────────────────────────────────────")
	fmt.Println()

	// Summary
	fmt.Println("═══════════════════════════════════════════════════════════")
	if errors == 0 && warnings == 0 {
		fmt.Println("  ✓ VERIFIED: Slot matches parent worktree 1:1")
	} else if errors == 0 {
		fmt.Printf("  ✓ VERIFIED with %d warning(s)\n", warnings)
	} else {
		fmt.Printf("  ✗ FAILED: %d error(s), %d warning(s)\n", errors, warnings)
	}
	fmt.Println("═══════════════════════════════════════════════════════════")

	if errors > 0 {
		os.Exit(1)
	}
}

func cmdFixPorts() {
	cwd, _ := os.Getwd()
	mainRepo, project := detectProject(cwd)

	if mainRepo == "" {
		fmt.Println("Error: not in a git repository")
		os.Exit(1)
	}

	// Must be run from slot (worktree)
	if mainRepo == cwd {
		fmt.Println("Error: must run from a slot worktree, not main")
		os.Exit(1)
	}

	slotPath := cwd

	// Extract slot number from directory name
	base := filepath.Base(slotPath)
	re := regexp.MustCompile(`-(\d+)$`)
	m := re.FindStringSubmatch(base)
	if len(m) < 2 {
		fmt.Println("Error: could not detect slot number from directory name")
		os.Exit(1)
	}
	slotNum, _ := strconv.Atoi(m[1])
	slotName := fmt.Sprintf("%s-%d", project, slotNum)

	fmt.Println("═══════════════════════════════════════════════════════════")
	fmt.Printf("  FIX PORTS: %s (slot %d)\n", slotName, slotNum)
	fmt.Println("═══════════════════════════════════════════════════════════")
	fmt.Println()

	// Scan main's ports
	fmt.Println("Scanning main project ports...")
	mainPorts := scanPorts(mainRepo)

	if len(mainPorts) == 0 {
		fmt.Println("No ports found in main project")
		return
	}

	// Calculate expected slot ports
	portMap := make(map[int]int)
	for mainPort, varName := range mainPorts {
		slotPort := mainPort + slotNum
		portMap[mainPort] = slotPort
		fmt.Printf("  %s: %d → %d\n", varName, mainPort, slotPort)
	}

	fmt.Println()

	// Scan current slot ports
	fmt.Println("Checking slot ports...")
	slotPorts := scanPorts(slotPath)

	// Find mismatches
	fixes := 0
	for mainPort, expectedSlotPort := range portMap {
		// Check if slot has this port at wrong value
		for currentPort := range slotPorts {
			if currentPort == mainPort {
				fmt.Printf("  ✗ Found main port %d (should be %d)\n", mainPort, expectedSlotPort)
				fixes++
			}
		}
	}

	if fixes == 0 {
		// Check if ports are correct
		allCorrect := true
		for _, expectedSlotPort := range portMap {
			if _, exists := slotPorts[expectedSlotPort]; !exists {
				allCorrect = false
				break
			}
		}
		if allCorrect {
			fmt.Println("  ✓ All ports are correct")
			return
		}
	}

	fmt.Println()
	fmt.Println("Fixing ports...")

	// Update all files
	updateSlotEnvFiles(slotPath, portMap, slotName)
	updateConfigFiles(slotPath, portMap)

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════")
	fmt.Println("  ✓ Ports fixed")
	fmt.Println("═══════════════════════════════════════════════════════════")
	fmt.Println()
	fmt.Println("Note: You may need to restart docker containers:")
	fmt.Println("  docker compose down && docker compose up -d")
}

// scanPorts scans a directory for port configurations
func scanPorts(dir string) map[int]string {
	ports := make(map[int]string)

	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		rel, _ := filepath.Rel(dir, path)
		skipDirs := []string{"node_modules", ".next", "dist", ".git"}
		for _, skip := range skipDirs {
			if strings.Contains(rel, skip) {
				return nil
			}
		}

		baseName := filepath.Base(path)
		isEnvFile := strings.Contains(baseName, ".env") && !strings.Contains(baseName, ".example")
		isConfigFile := baseName == ".mcp.json" || baseName == "package.json"

		if !isEnvFile && !isConfigFile {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		portRe := regexp.MustCompile(`^([A-Z_]*PORT)=["']?(\d+)["']?`)
		urlPortRe := regexp.MustCompile(`localhost:(\d+)`)
		pFlagRe := regexp.MustCompile(`-p\s+(\d+)`)

		for _, line := range strings.Split(string(content), "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "#") {
				continue
			}

			if isEnvFile {
				if m := portRe.FindStringSubmatch(line); len(m) > 2 {
					if port, err := strconv.Atoi(m[2]); err == nil && port > 1000 {
						if _, exists := ports[port]; !exists {
							ports[port] = m[1]
						}
					}
				}
			}

			for _, m := range urlPortRe.FindAllStringSubmatch(line, -1) {
				if port, err := strconv.Atoi(m[1]); err == nil && port > 1000 {
					if _, exists := ports[port]; !exists {
						ports[port] = "URL"
					}
				}
			}

			if isConfigFile && baseName == "package.json" {
				for _, m := range pFlagRe.FindAllStringSubmatch(line, -1) {
					if port, err := strconv.Atoi(m[1]); err == nil && port > 1000 {
						if _, exists := ports[port]; !exists {
							ports[port] = "script"
						}
					}
				}
			}
		}

		return nil
	})

	return ports
}

func cmdDBSync() {
	cwd, _ := os.Getwd()
	mainRepo, _ := detectProject(cwd)

	if mainRepo == "" {
		fmt.Println("Error: not in a git repository")
		os.Exit(1)
	}

	// Check if we're in a slot (worktree)
	if mainRepo == cwd {
		fmt.Println("Error: already in main worktree, nothing to sync")
		os.Exit(1)
	}

	slotPath := cwd

	fmt.Println("Syncing database from main worktree...\n")

	// Find docker-compose files in slot
	composeFiles := []string{}
	filepath.Walk(slotPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.Name() == "docker-compose.yml" || info.Name() == "docker-compose.yaml" {
			composeFiles = append(composeFiles, path)
		}
		return nil
	})

	if len(composeFiles) == 0 {
		fmt.Println("Error: no docker-compose files found")
		os.Exit(1)
	}

	synced := 0

	for _, composeFile := range composeFiles {
		composeDir := filepath.Dir(composeFile)
		mainComposeDir := strings.Replace(composeDir, slotPath, mainRepo, 1)
		relDir, _ := filepath.Rel(slotPath, composeDir)

		fmt.Printf("─── %s ───\n", relDir)

		// Read postgres config from compose file
		pgUser, pgPass, pgDB := parseDockerCompose(composeFile)

		// Find slot postgres port
		slotPgPort := 0
		for _, envName := range []string{".env.local", ".env"} {
			envPath := filepath.Join(composeDir, envName)
			if port := readEnvVar(envPath, "POSTGRES_PORT"); port > 0 {
				slotPgPort = port
				break
			}
		}

		// Find main postgres port
		mainPgPort := 0
		for _, envName := range []string{".env.local", ".env"} {
			envPath := filepath.Join(mainComposeDir, envName)
			if port := readEnvVar(envPath, "POSTGRES_PORT"); port > 0 {
				mainPgPort = port
				break
			}
		}

		if slotPgPort == 0 {
			fmt.Println("  ⚠ No POSTGRES_PORT found in slot, skipping")
			continue
		}

		if mainPgPort == 0 {
			fmt.Println("  ⚠ No POSTGRES_PORT found in main, skipping")
			continue
		}

		fmt.Printf("  Main DB: localhost:%d\n", mainPgPort)
		fmt.Printf("  Slot DB: localhost:%d\n", slotPgPort)

		// Check if main DB is running
		if !isPostgresReady(mainPgPort, pgUser, pgPass, pgDB) {
			fmt.Printf("  ⚠ Main DB not running on port %d, skipping\n", mainPgPort)
			continue
		}

		// Check if slot DB is running, start if not
		if !isPostgresReady(slotPgPort, pgUser, pgPass, pgDB) {
			fmt.Println("  Starting slot DB...")
			startDockerCompose(composeDir)
			if !waitForPostgres(slotPgPort, pgUser, pgPass, pgDB, 30) {
				fmt.Println("  ⚠ Could not start slot DB, skipping")
				continue
			}
		}

		// Clone database
		fmt.Printf("  Cloning %s...\n", pgDB)
		if err := cloneDatabase(mainPgPort, slotPgPort, pgUser, pgPass, pgDB); err != nil {
			fmt.Printf("  ✗ Failed to sync: %v\n", err)
			continue
		}
		fmt.Println("  ✓ Database synced")
		synced++
	}

	fmt.Println()
	if synced > 0 {
		fmt.Printf("✓ Synced %d database(s) from main\n", synced)
	} else {
		fmt.Println("⚠ No databases were synced")
	}
}

// Helper functions

func detectProject(cwd string) (mainRepo, project string) {
	// Check if in worktree
	gitFile := filepath.Join(cwd, ".git")
	if info, err := os.Stat(gitFile); err == nil && !info.IsDir() {
		content, _ := os.ReadFile(gitFile)
		// Parse: gitdir: /path/to/main/.git/worktrees/name
		line := strings.TrimSpace(string(content))
		if strings.HasPrefix(line, "gitdir:") {
			gitdir := strings.TrimSpace(strings.TrimPrefix(line, "gitdir:"))
			// Extract main repo path
			if idx := strings.Index(gitdir, "/.git/worktrees"); idx > 0 {
				mainRepo = gitdir[:idx]
				project = filepath.Base(mainRepo)
				return
			}
		}
	}

	// Check if in main repo
	if _, err := os.Stat(filepath.Join(cwd, ".git")); err == nil {
		mainRepo = cwd
		project = filepath.Base(cwd)
		return
	}

	return "", ""
}

func findNextSlotNumber(mainRepo, project string) int {
	parentDir := filepath.Dir(mainRepo)
	pattern := filepath.Join(parentDir, project+"-*")
	matches, _ := filepath.Glob(pattern)

	maxNum := 0
	re := regexp.MustCompile(`-(\d+)$`)
	for _, m := range matches {
		if match := re.FindStringSubmatch(filepath.Base(m)); len(match) > 1 {
			if n, err := strconv.Atoi(match[1]); err == nil && n > maxNum {
				maxNum = n
			}
		}
	}
	return maxNum + 1
}

func runCmd(dir string, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func copyGitignored(mainRepo, slotPath string) {
	cmd := exec.Command("git", "ls-files", "--others", "--ignored", "--exclude-standard")
	cmd.Dir = mainRepo
	out, err := cmd.Output()
	if err != nil {
		return
	}

	skipPatterns := []string{
		"node_modules", "dist/", "build/", ".next/", ".log",
		".husky/", "backups/", ".turbo/", ".venv/", ".trunk/", "coverage/",
	}

	for _, file := range strings.Split(string(out), "\n") {
		file = strings.TrimSpace(file)
		if file == "" {
			continue
		}

		// Skip patterns
		skip := false
		for _, p := range skipPatterns {
			if strings.Contains(file, p) {
				skip = true
				break
			}
		}
		if skip {
			continue
		}

		srcPath := filepath.Join(mainRepo, file)
		info, err := os.Stat(srcPath)
		if err != nil || info.IsDir() || info.Size() > 1048576 {
			continue
		}

		dstPath := filepath.Join(slotPath, file)
		os.MkdirAll(filepath.Dir(dstPath), 0755)

		content, err := os.ReadFile(srcPath)
		if err == nil {
			os.WriteFile(dstPath, content, info.Mode())
		}
	}
}

func scanAndAllocatePorts(mainRepo string, slotNum int) map[int]int {
	portMap := make(map[int]int)
	portVars := make(map[int]string) // port -> variable name for display

	fmt.Println("Scanning main project ports...")

	// Scan all relevant files for ports
	filepath.Walk(mainRepo, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		// Skip unwanted directories
		rel, _ := filepath.Rel(mainRepo, path)
		skipDirs := []string{"node_modules", ".next", "dist", ".git"}
		for _, skip := range skipDirs {
			if strings.Contains(rel, skip) {
				return nil
			}
		}

		baseName := filepath.Base(path)
		isEnvFile := strings.Contains(baseName, ".env") && !strings.Contains(baseName, ".example")
		isConfigFile := baseName == ".mcp.json" || baseName == "package.json"

		if !isEnvFile && !isConfigFile {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		portRe := regexp.MustCompile(`^([A-Z_]*PORT)=["']?(\d+)["']?`)
		urlPortRe := regexp.MustCompile(`localhost:(\d+)`)

		for _, line := range strings.Split(string(content), "\n") {
			// Skip comments
			if strings.HasPrefix(strings.TrimSpace(line), "#") {
				continue
			}

			// Check for PORT= or *_PORT= variables (env files)
			if isEnvFile {
				if m := portRe.FindStringSubmatch(line); len(m) > 2 {
					if port, err := strconv.Atoi(m[2]); err == nil && port > 1000 {
						if _, exists := portMap[port]; !exists {
							portVars[port] = m[1]
						}
					}
				}
			}

			// Check for localhost:PORT in URLs (all files)
			for _, m := range urlPortRe.FindAllStringSubmatch(line, -1) {
				if port, err := strconv.Atoi(m[1]); err == nil && port > 1000 {
					if _, exists := portMap[port]; !exists {
						if _, hasVar := portVars[port]; !hasVar {
							portVars[port] = "URL"
						}
					}
				}
			}

			// Check for -p PORT in package.json scripts (storybook pattern)
			if isConfigFile && baseName == "package.json" {
				pFlagRe := regexp.MustCompile(`-p\s+(\d+)`)
				for _, m := range pFlagRe.FindAllStringSubmatch(line, -1) {
					if port, err := strconv.Atoi(m[1]); err == nil && port > 1000 {
						if _, exists := portMap[port]; !exists {
							if _, hasVar := portVars[port]; !hasVar {
								portVars[port] = "script"
							}
						}
					}
				}
			}
		}

		return nil
	})

	// Allocate slot ports
	for mainPort, varName := range portVars {
		slotPort := mainPort + slotNum

		// Check if port is available, find next if not
		for !isPortAvailable(slotPort) {
			fmt.Printf("  Port %d in use, trying next...\n", slotPort)
			slotPort++
		}

		portMap[mainPort] = slotPort
		fmt.Printf("  %s: %d → %d\n", varName, mainPort, slotPort)
	}

	return portMap
}

func isPortAvailable(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return false
	}
	ln.Close()
	return true
}

func updateSlotEnvFiles(slotPath string, portMap map[int]int, slotName string) {
	dockerName := strings.ToLower(regexp.MustCompile(`[^a-z0-9-]`).ReplaceAllString(slotName, "-"))

	fmt.Println("\nUpdating slot .env files...")

	filepath.Walk(slotPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		rel, _ := filepath.Rel(slotPath, path)
		skipDirs := []string{"node_modules", ".next", "dist", ".git"}
		for _, skip := range skipDirs {
			if strings.Contains(rel, skip) {
				return nil
			}
		}

		baseName := filepath.Base(path)
		if !strings.Contains(baseName, ".env") {
			return nil
		}
		// Skip example files - they should remain as templates
		if strings.Contains(baseName, ".example") {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		newContent := string(content)

		// Replace or add COMPOSE_PROJECT_NAME
		composeRe := regexp.MustCompile(`(?m)^COMPOSE_PROJECT_NAME=.*$`)
		if composeRe.MatchString(newContent) {
			newContent = composeRe.ReplaceAllString(newContent, "COMPOSE_PROJECT_NAME="+dockerName)
		} else {
			// Add at the beginning of file
			newContent = "COMPOSE_PROJECT_NAME=" + dockerName + "\n" + newContent
		}

		// Replace each port
		for mainPort, slotPort := range portMap {
			// Replace =PORT and ="PORT"
			newContent = strings.ReplaceAll(newContent, fmt.Sprintf("=%d", mainPort), fmt.Sprintf("=%d", slotPort))
			newContent = strings.ReplaceAll(newContent, fmt.Sprintf("=\"%d\"", mainPort), fmt.Sprintf("=\"%d\"", slotPort))

			// Replace localhost:PORT
			newContent = strings.ReplaceAll(newContent, fmt.Sprintf("localhost:%d", mainPort), fmt.Sprintf("localhost:%d", slotPort))
		}

		if newContent != string(content) {
			os.WriteFile(path, []byte(newContent), info.Mode())
			fmt.Printf("  Updated: %s\n", rel)
		}

		return nil
	})
}

func updateConfigFiles(slotPath string, portMap map[int]int) {
	fmt.Println("\nUpdating config files...")

	filepath.Walk(slotPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		rel, _ := filepath.Rel(slotPath, path)
		skipDirs := []string{"node_modules", ".next", "dist", ".git"}
		for _, skip := range skipDirs {
			if strings.Contains(rel, skip) {
				return nil
			}
		}

		baseName := filepath.Base(path)
		if baseName != ".mcp.json" && baseName != "package.json" {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		newContent := string(content)

		// Replace localhost:PORT patterns
		for mainPort, slotPort := range portMap {
			newContent = strings.ReplaceAll(newContent, fmt.Sprintf("localhost:%d", mainPort), fmt.Sprintf("localhost:%d", slotPort))
			// Replace -p PORT patterns in scripts
			newContent = strings.ReplaceAll(newContent, fmt.Sprintf("-p %d", mainPort), fmt.Sprintf("-p %d", slotPort))
		}

		if newContent != string(content) {
			os.WriteFile(path, []byte(newContent), info.Mode())
			fmt.Printf("  Updated: %s\n", rel)
		}

		return nil
	})
}

func updateDockerComposeFiles(slotPath, slotName string) {
	dockerName := strings.ToLower(regexp.MustCompile(`[^a-z0-9-]`).ReplaceAllString(slotName, "-"))

	filepath.Walk(slotPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		if info.Name() != "docker-compose.yml" && info.Name() != "docker-compose.yaml" {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		newContent := string(content)

		// Replace hardcoded container_name with dynamic one
		// Pattern: container_name: something-db or container_name: something
		containerRe := regexp.MustCompile(`(?m)(container_name:\s*)([a-zA-Z0-9_-]+)`)
		newContent = containerRe.ReplaceAllString(newContent, "${1}${COMPOSE_PROJECT_NAME:-"+dockerName+"}-db")

		if newContent != string(content) {
			os.WriteFile(path, []byte(newContent), info.Mode())
			rel, _ := filepath.Rel(slotPath, path)
			fmt.Printf("  Updated: %s (container_name)\n", rel)
		}

		return nil
	})
}

func startDockerAndClone(mainRepo, slotPath string, portMap map[int]int) {
	// Find docker-compose files
	composeFiles := []string{}
	filepath.Walk(slotPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.Name() == "docker-compose.yml" || info.Name() == "docker-compose.yaml" {
			composeFiles = append(composeFiles, path)
		}
		return nil
	})

	if len(composeFiles) == 0 {
		return
	}

	fmt.Println("\nStarting docker and cloning database...")

	for _, composeFile := range composeFiles {
		composeDir := filepath.Dir(composeFile)
		mainComposeDir := strings.Replace(composeDir, slotPath, mainRepo, 1)

		// Read postgres config from compose file
		pgUser, pgPass, pgDB := parseDockerCompose(composeFile)

		// Find slot and main postgres ports
		slotPgPort := 0
		mainPgPort := 0

		// Look for POSTGRES_PORT in slot's env
		for _, envName := range []string{".env.local", ".env"} {
			envPath := filepath.Join(composeDir, envName)
			if port := readEnvVar(envPath, "POSTGRES_PORT"); port > 0 {
				slotPgPort = port
				break
			}
		}

		// Look for POSTGRES_PORT in main's env
		for _, envName := range []string{".env.local", ".env"} {
			envPath := filepath.Join(mainComposeDir, envName)
			if port := readEnvVar(envPath, "POSTGRES_PORT"); port > 0 {
				mainPgPort = port
				break
			}
		}

		if slotPgPort == 0 {
			fmt.Printf("  Skipping %s: no POSTGRES_PORT\n", filepath.Base(composeDir))
			continue
		}

		// Start docker
		fmt.Printf("  Starting docker in %s...\n", filepath.Base(composeDir))
		startDockerCompose(composeDir)

		// Wait for postgres
		fmt.Printf("  Waiting for postgres on port %d...\n", slotPgPort)
		waitForPostgres(slotPgPort, pgUser, pgPass, pgDB, 30)

		// Clone database if main is running
		if mainPgPort > 0 && isPostgresReady(mainPgPort, pgUser, pgPass, pgDB) {
			fmt.Printf("  Cloning database from port %d to %d...\n", mainPgPort, slotPgPort)
			if err := cloneDatabase(mainPgPort, slotPgPort, pgUser, pgPass, pgDB); err != nil {
				fmt.Printf("  ✗ Failed to clone: %v\n", err)
			} else {
				fmt.Println("  ✓ Database cloned")
			}
		} else {
			fmt.Printf("  ⚠ Main DB not running on port %d, skipping clone\n", mainPgPort)
		}
	}
}

func parseDockerCompose(path string) (user, pass, db string) {
	user, pass, db = "postgres", "postgres", "postgres"

	content, err := os.ReadFile(path)
	if err != nil {
		return
	}

	lines := strings.Split(string(content), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "POSTGRES_USER:") {
			user = strings.Trim(strings.TrimPrefix(line, "POSTGRES_USER:"), " \"'")
		} else if strings.HasPrefix(line, "POSTGRES_PASSWORD:") {
			pass = strings.Trim(strings.TrimPrefix(line, "POSTGRES_PASSWORD:"), " \"'")
		} else if strings.HasPrefix(line, "POSTGRES_DB:") {
			db = strings.Trim(strings.TrimPrefix(line, "POSTGRES_DB:"), " \"'")
		}
	}
	return
}

func readEnvVar(path, varName string) int {
	content, err := os.ReadFile(path)
	if err != nil {
		return 0
	}

	re := regexp.MustCompile(fmt.Sprintf(`(?m)^%s=["']?(\d+)["']?`, varName))
	if m := re.FindStringSubmatch(string(content)); len(m) > 1 {
		if n, err := strconv.Atoi(m[1]); err == nil {
			return n
		}
	}
	return 0
}

func startDockerCompose(dir string) {
	// Try with .env.local first, then .env
	for _, envFile := range []string{".env.local", ".env"} {
		envPath := filepath.Join(dir, envFile)
		if _, err := os.Stat(envPath); err == nil {
			cmd := exec.Command("docker", "compose", "--env-file", envFile, "up", "-d")
			cmd.Dir = dir
			if cmd.Run() == nil {
				return
			}
		}
	}

	// Fallback without env file
	cmd := exec.Command("docker", "compose", "up", "-d")
	cmd.Dir = dir
	cmd.Run()
}

func waitForPostgres(port int, user, pass, db string, timeoutSecs int) bool {
	for i := 0; i < timeoutSecs; i++ {
		if isPostgresReady(port, user, pass, db) {
			return true
		}
		time.Sleep(time.Second)
	}
	return false
}

func isPostgresReady(port int, user, pass, db string) bool {
	cmd := exec.Command("psql", "-h", "localhost", "-p", strconv.Itoa(port), "-U", user, "-c", "SELECT 1", db)
	cmd.Env = append(os.Environ(), "PGPASSWORD="+pass)
	return cmd.Run() == nil
}

func cloneDatabase(srcPort, dstPort int, user, pass, db string) error {
	env := append(os.Environ(), "PGPASSWORD="+pass)

	// 1. Terminate existing connections to target DB
	terminateCmd := fmt.Sprintf(
		`psql -h localhost -p %d -U %s -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='%s' AND pid <> pg_backend_pid();"`,
		dstPort, user, db,
	)
	cmd := exec.Command("sh", "-c", terminateCmd)
	cmd.Env = env
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to terminate connections: %w", err)
	}

	// 2. Drop and recreate target DB
	dropCreateCmd := fmt.Sprintf(
		`psql -h localhost -p %d -U %s -d postgres -c "DROP DATABASE IF EXISTS %s;" -c "CREATE DATABASE %s;"`,
		dstPort, user, db, db,
	)
	cmd = exec.Command("sh", "-c", dropCreateCmd)
	cmd.Env = env
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to drop/create database: %w", err)
	}

	// 3. Pipe dump to fresh DB
	pipeCmd := fmt.Sprintf(
		"pg_dump -h localhost -p %d -U %s --no-owner --no-acl %s | psql -h localhost -p %d -U %s %s",
		srcPort, user, db, dstPort, user, db,
	)
	cmd = exec.Command("sh", "-c", pipeCmd)
	cmd.Env = env
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to restore database: %w", err)
	}

	return nil
}

func stopDocker(slotPath string) {
	filepath.Walk(slotPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.Name() == "docker-compose.yml" || info.Name() == "docker-compose.yaml" {
			dir := filepath.Dir(path)
			cmd := exec.Command("docker", "compose", "down", "-v")
			cmd.Dir = dir
			cmd.Run()
		}
		return nil
	})
}

func installDeps(slotPath string) {
	fmt.Println("\nInstalling dependencies...")

	filepath.Walk(slotPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		if strings.Contains(path, "node_modules") {
			return filepath.SkipDir
		}

		if info.Name() == "pnpm-lock.yaml" {
			dir := filepath.Dir(path)
			rel, _ := filepath.Rel(slotPath, dir)
			fmt.Printf("  Installing in %s...\n", rel)

			cmd := exec.Command("pnpm", "install", "--frozen-lockfile")
			cmd.Dir = dir
			cmd.Run()
		}
		return nil
	})
}

func getBranchName(repoPath string) string {
	out, err := exec.Command("git", "-C", repoPath, "branch", "--show-current").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func getClaudeInfo(pid string) map[string]string {
	// Get working directory
	out, err := exec.Command("lsof", "-p", pid).Output()
	if err != nil {
		return nil
	}

	cwd := ""
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "cwd") {
			fields := strings.Fields(line)
			if len(fields) > 0 {
				cwd = fields[len(fields)-1]
			}
		}
	}

	if cwd == "" {
		return nil
	}

	project := filepath.Base(cwd)
	branch, _ := exec.Command("git", "-C", cwd, "branch", "--show-current").Output()

	// Get runtime
	runtime, _ := exec.Command("ps", "-p", pid, "-o", "etime=").Output()

	// Get session info from claude files
	projectKey := strings.ReplaceAll(cwd, "/", "-")
	sessionDir := filepath.Join(os.Getenv("HOME"), ".claude", "projects", projectKey)

	slug := "unknown"
	model := "unknown"

	files, _ := filepath.Glob(filepath.Join(sessionDir, "*.jsonl"))
	if len(files) > 0 {
		// Sort by modification time, get newest
		sort.Slice(files, func(i, j int) bool {
			fi, _ := os.Stat(files[i])
			fj, _ := os.Stat(files[j])
			return fi.ModTime().After(fj.ModTime())
		})

		content, _ := os.ReadFile(files[0])
		lines := strings.Split(string(content), "\n")
		for _, line := range lines {
			if strings.Contains(line, `"slug"`) {
				var data map[string]interface{}
				if json.Unmarshal([]byte(line), &data) == nil {
					if s, ok := data["slug"].(string); ok {
						slug = s
					}
				}
			}
			if strings.Contains(line, `"model"`) {
				var data map[string]interface{}
				if json.Unmarshal([]byte(line), &data) == nil {
					if m, ok := data["model"].(string); ok {
						model = strings.ReplaceAll(m, "claude-", "")
						model = strings.ReplaceAll(model, "-20251101", "")
					}
				}
			}
		}
	}

	return map[string]string{
		"project": project,
		"branch":  strings.TrimSpace(string(branch)),
		"session": slug,
		"model":   model,
		"runtime": strings.TrimSpace(string(runtime)),
	}
}

func loadRegistry() *Registry {
	os.MkdirAll(filepath.Dir(registryPath), 0755)

	data, err := os.ReadFile(registryPath)
	if err != nil {
		return &Registry{
			Groups:   make(map[string]GroupConfig),
			Projects: make(map[string]ProjectConfig),
			Slots:    make(map[string]SlotConfig),
		}
	}

	var reg Registry
	if json.Unmarshal(data, &reg) != nil {
		return &Registry{
			Groups:   make(map[string]GroupConfig),
			Projects: make(map[string]ProjectConfig),
			Slots:    make(map[string]SlotConfig),
		}
	}

	if reg.Groups == nil {
		reg.Groups = make(map[string]GroupConfig)
	}
	if reg.Projects == nil {
		reg.Projects = make(map[string]ProjectConfig)
	}
	if reg.Slots == nil {
		reg.Slots = make(map[string]SlotConfig)
	}

	return &reg
}

func saveRegistry(reg *Registry) {
	data, _ := json.MarshalIndent(reg, "", "  ")
	os.WriteFile(registryPath, data, 0644)
}

func updateRegistry(slotName, project string, number int, branch string) {
	updateRegistryFull(slotName, project, number, "", branch)
}

func updateRegistryFull(slotName, project string, number int, name, branch string) {
	reg := loadRegistry()
	reg.Slots[slotName] = SlotConfig{
		Project:   project,
		Number:    number,
		Name:      name,
		Branch:    branch,
		CreatedAt: time.Now().Format(time.RFC3339),
	}
	saveRegistry(reg)
}

// extractSlotIdentifier extracts the slot number or name from a slot directory name
func extractSlotIdentifier(slotName, project string) string {
	prefix := project + "-"
	if !strings.HasPrefix(slotName, prefix) {
		return slotName
	}
	suffix := strings.TrimPrefix(slotName, prefix)
	// Check if it's a number
	if _, err := strconv.Atoi(suffix); err == nil {
		return suffix
	}
	return suffix
}

func removeFromRegistry(slotName string) {
	reg := loadRegistry()
	delete(reg.Slots, slotName)
	saveRegistry(reg)
}
