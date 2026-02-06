package main

import (
	"bufio"
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
	Projects map[string]ProjectConfig `json:"projects"`
	Slots    map[string]SlotConfig    `json:"slots"`
}

type ProjectConfig struct {
	BasePort int    `json:"base_port"`
	Path     string `json:"path"`
}

type SlotConfig struct {
	Project   string `json:"project"`
	Number    int    `json:"number"`
	Branch    string `json:"branch"`
	CreatedAt string `json:"created_at"`
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
	case "check":
		cmdCheck(args)
	default:
		printUsage()
	}
}

func printUsage() {
	fmt.Println(`slot-cli - Smart slot management for parallel development

Commands:
  new [N]           Create slot (auto-increment if no number)
  delete <N>        Delete slot (use --force to skip confirmation)
  list              Show running Claude instances
  start             Start Claude in current directory
  continue          Continue Claude session
  check [N]         Validate slot configuration

Options:
  --force, -f       Force delete without confirmation`)
}

func cmdNew(args []string) {
	// Parse slot number
	slotNum := 0
	for _, arg := range args {
		if n, err := strconv.Atoi(arg); err == nil {
			slotNum = n
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

	// Auto-increment slot number if not provided
	if slotNum == 0 {
		slotNum = findNextSlotNumber(mainRepo, project)
		fmt.Printf("Auto-assigned slot: %d\n", slotNum)
	}

	slotName := fmt.Sprintf("%s-%d", project, slotNum)
	slotPath := filepath.Join(filepath.Dir(mainRepo), slotName)

	// Check if exists
	if _, err := os.Stat(slotPath); err == nil {
		fmt.Printf("Error: Slot %s already exists at %s\n", slotName, slotPath)
		os.Exit(1)
	}

	fmt.Printf("Creating slot: %s\n\n", slotName)

	// Create worktree
	branchName := fmt.Sprintf("slot-%d", slotNum)
	runCmd(mainRepo, "git", "worktree", "add", slotPath, "-b", branchName)
	fmt.Println("✓ Created worktree")

	// Copy gitignored files
	copyGitignored(mainRepo, slotPath)
	fmt.Println("✓ Copied gitignored files")

	// Scan ports from main and update slot
	portMap := scanAndAllocatePorts(mainRepo, slotNum)
	if len(portMap) > 0 {
		updateSlotEnvFiles(slotPath, portMap, slotName)
		updateDockerComposeFiles(slotPath, slotName)
		fmt.Println("✓ Port mapping complete")

		// Start docker and clone database
		startDockerAndClone(mainRepo, slotPath, portMap)
	}

	// Install dependencies
	installDeps(slotPath)

	// Update registry
	updateRegistry(slotName, project, slotNum, branchName)

	// Summary
	fmt.Println("\n════════════════════════════════════════")
	fmt.Printf("✓ Slot %d ready\n\n", slotNum)
	fmt.Printf("  Path: %s\n", slotPath)
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
	fmt.Println("→ Then: slot start")
}

func cmdDelete(args []string) {
	force := false
	slotNum := 0

	for _, arg := range args {
		if arg == "--force" || arg == "-f" {
			force = true
		} else if n, err := strconv.Atoi(arg); err == nil {
			slotNum = n
		}
	}

	if slotNum == 0 {
		fmt.Println("Error: need slot number")
		fmt.Println("Usage: slot delete <number> [--force]")
		os.Exit(1)
	}

	cwd, _ := os.Getwd()
	mainRepo, project := detectProject(cwd)
	slotName := fmt.Sprintf("%s-%d", project, slotNum)
	slotPath := filepath.Join(filepath.Dir(mainRepo), slotName)

	if _, err := os.Stat(slotPath); os.IsNotExist(err) {
		fmt.Printf("Error: Slot %s not found\n", slotName)
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

	fmt.Printf("✓ Deleted slot %d\n", slotNum)
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
	cmd := exec.Command("claude", "--dangerously-skip-permissions")
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Run()
}

func cmdContinue() {
	cmd := exec.Command("claude", "--continue", "--dangerously-skip-permissions")
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

	// Find all .env files
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

		// Only process .env* files
		if !strings.Contains(filepath.Base(path), ".env") {
			return nil
		}

		// Parse env file for ports
		file, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer file.Close()

		scanner := bufio.NewScanner(file)
		portRe := regexp.MustCompile(`^([A-Z_]*PORT)=["']?(\d+)["']?`)
		urlPortRe := regexp.MustCompile(`localhost:(\d+)`)

		for scanner.Scan() {
			line := scanner.Text()

			// Skip comments
			if strings.HasPrefix(strings.TrimSpace(line), "#") {
				continue
			}

			// Check for PORT= or *_PORT= variables
			if m := portRe.FindStringSubmatch(line); len(m) > 2 {
				if port, err := strconv.Atoi(m[2]); err == nil && port > 1000 {
					if _, exists := portMap[port]; !exists {
						portVars[port] = m[1]
					}
				}
			}

			// Check for localhost:PORT in URLs
			for _, m := range urlPortRe.FindAllStringSubmatch(line, -1) {
				if port, err := strconv.Atoi(m[1]); err == nil && port > 1000 {
					if _, exists := portMap[port]; !exists {
						if _, hasVar := portVars[port]; !hasVar {
							portVars[port] = "URL"
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

		if !strings.Contains(filepath.Base(path), ".env") {
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
			cloneDatabase(mainPgPort, slotPgPort, pgUser, pgPass, pgDB)
			fmt.Println("  ✓ Database cloned")
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

func cloneDatabase(srcPort, dstPort int, user, pass, db string) {
	// Use shell to pipe - avoids Go pipe deadlock issues
	cmdStr := fmt.Sprintf(
		"pg_dump -h localhost -p %d -U %s %s | psql -h localhost -p %d -U %s %s",
		srcPort, user, db, dstPort, user, db,
	)
	cmd := exec.Command("sh", "-c", cmdStr)
	cmd.Env = append(os.Environ(), "PGPASSWORD="+pass)
	cmd.Run()
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
			Projects: make(map[string]ProjectConfig),
			Slots:    make(map[string]SlotConfig),
		}
	}

	var reg Registry
	if json.Unmarshal(data, &reg) != nil {
		return &Registry{
			Projects: make(map[string]ProjectConfig),
			Slots:    make(map[string]SlotConfig),
		}
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
	reg := loadRegistry()
	reg.Slots[slotName] = SlotConfig{
		Project:   project,
		Number:    number,
		Branch:    branch,
		CreatedAt: time.Now().Format(time.RFC3339),
	}
	saveRegistry(reg)
}

func removeFromRegistry(slotName string) {
	reg := loadRegistry()
	delete(reg.Slots, slotName)
	saveRegistry(reg)
}
