const response = await fetch("http://127.0.0.1:8080/api/health");
process.exitCode = response.ok ? 0 : 1;
