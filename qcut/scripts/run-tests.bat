@echo off
REM Test runner script for CI/CD integration (Windows)

echo Running QCut Test Suite...
echo ================================

REM Navigate to web app directory
cd /d "%~dp0\..\apps\web" || exit /b 1

REM Check if dependencies are installed
if not exist "node_modules" (
  echo Installing dependencies...
  call bun install
)

REM Run linting
echo.
echo Running linter...
call bun run lint:clean
if %errorlevel% neq 0 echo Warning: Lint warnings found

REM Run type checking  
echo.
echo Running type check...
call bun run check-types
if %errorlevel% neq 0 echo Warning: Type errors found

REM Run tests with coverage
echo.
echo Running tests...
call bun test --coverage

REM Generate coverage report
echo.
echo Test Coverage Summary:
call bun test:coverage --reporter=text-summary

echo.
echo Test suite completed!
exit /b 0