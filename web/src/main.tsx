import '@fontsource-variable/outfit';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/anton';
import '@fontsource-variable/source-serif-4/wght-italic.css';
// Cyrillic fallback: Outfit and Bricolage Grotesque only cover Latin.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App, { router } from './App';
import { AuthProvider } from './components/common/AuthProvider';
import { ThemeProvider } from './components/common/ThemeProvider';
import { Toaster } from './components/ui/toaster';
import { TooltipProvider } from './components/ui/tooltip';
import { I18nProvider } from './i18n';
import { queryClient } from './lib/query-client';

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider>
          <TooltipProvider>
            <AuthProvider navigate={(to, replace) => void router.navigate(to, { replace })}>
              <App />
            </AuthProvider>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
