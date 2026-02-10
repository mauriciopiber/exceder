package main

import (
	"fmt"
	"testing"
)

func TestTitleCase(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"single char", "a", "A"},
		{"already capitalized", "Hello", "Hello"},
		{"lowercase", "hello", "Hello"},
		{"all caps", "HELLO", "HELLO"},
		{"hyphenated", "hello-world", "Hello-world"},
		{"single uppercase", "A", "A"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := titleCase(tt.in)
			if got != tt.want {
				t.Errorf("titleCase(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestDetectGroupFromPath(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
	}{
		{"standard path", "/Users/john/Projects/piber/exceder", "piber"},
		{"no Projects dir", "/Users/john/code/myapp", ""},
		{"trailing slash", "/Users/john/Projects/piber/exceder/", "piber"},
		{"too shallow", "/Projects", ""},
		{"Projects at end", "/Users/john/Projects", ""},
		{"Projects with one child", "/Users/john/Projects/piber", ""},
		{"nested Projects", "/home/user/Projects/org/repo", "org"},
		{"deep path", "/Users/john/Projects/acme/frontend/src", "acme"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := detectGroupFromPath(tt.path)
			if got != tt.want {
				t.Errorf("detectGroupFromPath(%q) = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}

func TestParseDockerComposeContent(t *testing.T) {
	tests := []struct {
		name             string
		content          string
		wantUser         string
		wantPass         string
		wantDB           string
	}{
		{
			"all three values",
			"POSTGRES_USER: myuser\nPOSTGRES_PASSWORD: mypass\nPOSTGRES_DB: mydb",
			"myuser", "mypass", "mydb",
		},
		{
			"quoted values",
			`POSTGRES_USER: "myuser"
POSTGRES_PASSWORD: 'mypass'
POSTGRES_DB: "mydb"`,
			"myuser", "mypass", "mydb",
		},
		{
			"partial - only user",
			"POSTGRES_USER: admin",
			"admin", "postgres", "postgres",
		},
		{
			"empty content",
			"",
			"postgres", "postgres", "postgres",
		},
		{
			"with surrounding yaml",
			`services:
  postgres:
    environment:
      POSTGRES_USER: dbuser
      POSTGRES_PASSWORD: dbpass
      POSTGRES_DB: appdb
    ports:
      - "5432:5432"`,
			"dbuser", "dbpass", "appdb",
		},
		{
			"extra whitespace",
			"POSTGRES_USER:   spaced  ",
			"spaced", "postgres", "postgres",
		},
		{
			"empty pass-through values",
			"POSTGRES_USER:\nPOSTGRES_PASSWORD:\nPOSTGRES_DB:",
			"postgres", "postgres", "postgres",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			user, pass, db := parseDockerComposeContent(tt.content)
			if user != tt.wantUser {
				t.Errorf("user = %q, want %q", user, tt.wantUser)
			}
			if pass != tt.wantPass {
				t.Errorf("pass = %q, want %q", pass, tt.wantPass)
			}
			if db != tt.wantDB {
				t.Errorf("db = %q, want %q", db, tt.wantDB)
			}
		})
	}
}

func TestParseEnvVarInt(t *testing.T) {
	tests := []struct {
		name    string
		content string
		varName string
		want    int
	}{
		{
			"exact match",
			"PORT=3000\nOTHER=5000",
			"PORT", 3000,
		},
		{
			"PORT should not match POSTGRES_PORT",
			"POSTGRES_PORT=5432\nPORT=3000",
			"PORT", 3000,
		},
		{
			"POSTGRES_PORT exact match",
			"POSTGRES_PORT=5432\nPORT=3000",
			"POSTGRES_PORT", 5432,
		},
		{
			"quoted value",
			`PORT="3000"`,
			"PORT", 3000,
		},
		{
			"single quoted",
			"PORT='3000'",
			"PORT", 3000,
		},
		{
			"commented line should not match",
			"# PORT=3000\nPORT=4000",
			"PORT", 4000,
		},
		{
			"var not present",
			"OTHER=5000",
			"PORT", 0,
		},
		{
			"empty content",
			"",
			"PORT", 0,
		},
		{
			"non-numeric value",
			"PORT=abc",
			"PORT", 0,
		},
		{
			"STORYBOOK_PORT",
			"STORYBOOK_PORT=6006",
			"STORYBOOK_PORT", 6006,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseEnvVarInt(tt.content, tt.varName)
			if got != tt.want {
				t.Errorf("parseEnvVarInt(%q, %q) = %d, want %d", tt.content, tt.varName, got, tt.want)
			}
		})
	}
}

func TestExtractPortFromEnvLine(t *testing.T) {
	tests := []struct {
		name     string
		line     string
		wantVar  string
		wantPort int
		wantOK   bool
	}{
		{"PORT=3000", "PORT=3000", "PORT", 3000, true},
		{"POSTGRES_PORT=5432", "POSTGRES_PORT=5432", "POSTGRES_PORT", 5432, true},
		{"STORYBOOK_PORT=6006", "STORYBOOK_PORT=6006", "STORYBOOK_PORT", 6006, true},
		{"quoted port", `PORT="3000"`, "PORT", 3000, true},
		{"single quoted port", "PORT='4000'", "PORT", 4000, true},
		{"TRANSPORT= not a port var", "TRANSPORT=grpc", "", 0, false},
		{"port too low", "PORT=80", "", 0, false},
		{"port=1000 boundary", "PORT=1000", "", 0, false},
		{"port=1001 boundary", "PORT=1001", "PORT", 1001, true},
		{"no equals sign", "PORT 3000", "", 0, false},
		{"lowercase var", "port=3000", "", 0, false},
		{"empty line", "", "", 0, false},
		{"comment line", "# PORT=3000", "", 0, false},
		{"NEXT_PUBLIC_PORT=3001", "NEXT_PUBLIC_PORT=3001", "NEXT_PUBLIC_PORT", 3001, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			varName, port, ok := extractPortFromEnvLine(tt.line)
			if ok != tt.wantOK {
				t.Errorf("ok = %v, want %v", ok, tt.wantOK)
			}
			if varName != tt.wantVar {
				t.Errorf("varName = %q, want %q", varName, tt.wantVar)
			}
			if port != tt.wantPort {
				t.Errorf("port = %d, want %d", port, tt.wantPort)
			}
		})
	}
}

func TestReplacePortsInEnvContent(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		portMap  map[int]int
		slotName string
		want     string
	}{
		{
			"basic port replacement",
			"PORT=3000\nDB_PORT=5432",
			map[int]int{3000: 3010, 5432: 5442},
			"exceder-1",
			"COMPOSE_PROJECT_NAME=exceder-1\nPORT=3010\nDB_PORT=5442",
		},
		{
			"COMPOSE_PROJECT_NAME update",
			"COMPOSE_PROJECT_NAME=exceder\nPORT=3000",
			map[int]int{3000: 3010},
			"exceder-1",
			"COMPOSE_PROJECT_NAME=exceder-1\nPORT=3010",
		},
		{
			"localhost URLs",
			"API_URL=http://localhost:3000/api\nDB_HOST=localhost:5432",
			map[int]int{3000: 3010, 5432: 5442},
			"exceder-1",
			"COMPOSE_PROJECT_NAME=exceder-1\nAPI_URL=http://localhost:3010/api\nDB_HOST=localhost:5442",
		},
		{
			"quoted port values",
			`PORT="3000"`,
			map[int]int{3000: 3010},
			"exceder-1",
			"COMPOSE_PROJECT_NAME=exceder-1\nPORT=\"3010\"",
		},
		{
			"no ports to replace",
			"NAME=hello",
			map[int]int{},
			"exceder-1",
			"COMPOSE_PROJECT_NAME=exceder-1\nNAME=hello",
		},
		{
			"slot name sanitization",
			"PORT=3000",
			map[int]int{3000: 3010},
			"exceder_auth",
			"COMPOSE_PROJECT_NAME=exceder-auth\nPORT=3010",
		},
		{
			"multiple ports same line",
			"FORWARD=localhost:3000,localhost:4000",
			map[int]int{3000: 3010, 4000: 4010},
			"app-1",
			"COMPOSE_PROJECT_NAME=app-1\nFORWARD=localhost:3010,localhost:4010",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := replacePortsInEnvContent(tt.content, tt.portMap, tt.slotName)
			if got != tt.want {
				t.Errorf("replacePortsInEnvContent() =\n%q\nwant:\n%q", got, tt.want)
			}
		})
	}
}

func TestResolveSlotNamePure(t *testing.T) {
	tests := []struct {
		name      string
		project   string
		cwdBase   string
		cwdIsSlot bool
		args      []string
		want      string
	}{
		{
			"in slot dir, args ignored",
			"exceder", "exceder-1", true,
			[]string{"2"},
			"exceder-1",
		},
		{
			"numeric arg",
			"exceder", "exceder", false,
			[]string{"2"},
			"exceder-2",
		},
		{
			"named arg",
			"exceder", "exceder", false,
			[]string{"auth"},
			"exceder-auth",
		},
		{
			"flags skipped",
			"exceder", "exceder", false,
			[]string{"--force", "3"},
			"exceder-3",
		},
		{
			"no args, returns cwdBase",
			"exceder", "exceder", false,
			[]string{},
			"exceder",
		},
		{
			"double-dash flag skipped",
			"exceder", "exceder", false,
			[]string{"--dry-run", "auth"},
			"exceder-auth",
		},
		{
			"-f flag skipped",
			"exceder", "exceder", false,
			[]string{"-f", "1"},
			"exceder-1",
		},
		{
			"in slot dir with no args",
			"exceder", "exceder-auth", true,
			[]string{},
			"exceder-auth",
		},
		{
			"only flags, no identifier",
			"exceder", "exceder", false,
			[]string{"--force", "-f"},
			"exceder",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveSlotNamePure(tt.project, tt.cwdBase, tt.cwdIsSlot, tt.args)
			if got != tt.want {
				t.Errorf("resolveSlotNamePure(%q, %q, %v, %v) = %q, want %q",
					tt.project, tt.cwdBase, tt.cwdIsSlot, tt.args, got, tt.want)
			}
		})
	}
}

func TestAllocateSlotPorts(t *testing.T) {
	tests := []struct {
		name    string
		ports   map[int]string
		slotNum int
		want    map[int]int
	}{
		{
			"no collisions - ports far apart",
			map[int]string{3000: "PORT", 5432: "DB_PORT"},
			1,
			map[int]int{3000: 3001, 5432: 5433},
		},
		{
			"consecutive ports with offset 1",
			map[int]string{3000: "PORT", 3001: "NEXT_PORT", 3002: "STORYBOOK_PORT", 3003: "DB_PORT"},
			1,
			// 3000+1=3001 collides with main 3001 → 3004 (first free)
			// 3001+1=3002 collides with main 3002 → 3005
			// 3002+1=3003 collides with main 3003 → 3006
			// 3003+1=3004 already allocated → 3007
			map[int]int{3000: 3004, 3001: 3005, 3002: 3006, 3003: 3007},
		},
		{
			"main port overlaps slot port",
			map[int]string{3000: "PORT", 3002: "OTHER_PORT"},
			2,
			// 3000+2=3002 collides with main 3002 → 3003
			// 3002+2=3004, no collision → 3004
			map[int]int{3000: 3003, 3002: 3004},
		},
		{
			"single port trivial",
			map[int]string{8080: "PORT"},
			1,
			map[int]int{8080: 8081},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := allocateSlotPorts(tt.ports, tt.slotNum)
			if len(got) != len(tt.want) {
				t.Fatalf("got %d entries, want %d: %v", len(got), len(tt.want), got)
			}
			for k, wantV := range tt.want {
				if gotV, ok := got[k]; !ok {
					t.Errorf("missing key %d", k)
				} else if gotV != wantV {
					t.Errorf("port %d: got %d, want %d", k, gotV, wantV)
				}
			}
			// Check no duplicate slot ports allocated
			seen := make(map[int]bool)
			for mainPort, slotPort := range got {
				if seen[slotPort] {
					t.Errorf("duplicate slot port %d (from main %d)", slotPort, mainPort)
				}
				seen[slotPort] = true
			}
		})
	}
}

func TestAllocateSlotPortsNoDuplicates(t *testing.T) {
	// Fuzz-like test: many consecutive ports should never produce duplicates
	ports := make(map[int]string)
	for i := 0; i < 10; i++ {
		ports[3000+i] = fmt.Sprintf("PORT_%d", i)
	}
	for slotNum := 1; slotNum <= 5; slotNum++ {
		got := allocateSlotPorts(ports, slotNum)
		seen := make(map[int]bool)
		for mainPort, slotPort := range got {
			if seen[slotPort] {
				t.Errorf("slotNum=%d: duplicate slot port %d (from main %d)", slotNum, slotPort, mainPort)
			}
			seen[slotPort] = true
			// Slot port must not collide with any main port
			if _, isMain := ports[slotPort]; isMain {
				t.Errorf("slotNum=%d: slot port %d collides with main port", slotNum, slotPort)
			}
		}
	}
}
