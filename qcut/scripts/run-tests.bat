@echo off
REM Test runner script for CI/CD integration (Windows)

echo Running QCut Test Suite...
echo ================================

REM Navigate to repository root first
cd /d "%~dp0\.." || exit /b 1

REM Ensure Bun is available
where bun >nul 2>nul
if %errorlevel% neq 0 (
  echo Error: Bun is not installed or not on PATH. Please install Bun and retry.
  exit /b 1
)

REM Check if dependencies are installed
if not exist "node_modules" (
  echo Installing dependencies...
  call bun install
  if errorlevel 1 (
    echo Error: Dependency installation failed. See logs above.
    exit /b 1
  )
)

REM Run linting from root
echo.
echo Running linter...
call bun run lint:clean
if %errorlevel% neq 0 echo Warning: Lint warnings found

REM Run type checking from root
echo.
echo Running type check...
call bun run check-types
if %errorlevel% neq 0 echo Warning: Type errors found

REM Navigate to web app directory for tests
cd /d "%~dp0\..\apps\web" || exit /b 1

REM Run tests with coverage
echo.
echo Running tests...
set EXIT_CODE=0
call bun test --coverage
set EXIT_CODE=%errorlevel%

REM Generate coverage report (best-effort)
echo.
echo Test Coverage Summary:
call bun run test:coverage --reporter=text-summary

echo.
if %EXIT_CODE% neq 0 (
  echo Tests failed with exit code %EXIT_CODE%.
) else (
  echo Test suite completed successfully!
)
exit /b %EXIT_CODE%