import { AppShell } from "./components/layout/AppShell";
import { ThemeProvider } from "./components/theme/ThemeProvider";
import { MainWorkspace } from "./MainWorkspace";

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="space-analyzer-theme">
      <AppShell>
        <MainWorkspace />
      </AppShell>
    </ThemeProvider>
  );
}

export default App;
