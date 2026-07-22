import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LocaleProvider } from './context'
import { AuthShell } from './components/AuthShell'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { BrowsePage } from './pages/BrowsePage'
import { SearchPage } from './pages/SearchPage'
import { CategoriesPage } from './pages/CategoriesPage'
import { GenresPage, MakersPage } from './pages/CategoryIndexPage'
import { WatchPage } from './pages/WatchPage'
import { ActressesPage } from './pages/ActressesPage'
import { ActressDetailPage } from './pages/ActressDetailPage'

export default function App() {
  return (
    <LocaleProvider>
      <AuthShell>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="browse" element={<BrowsePage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="actresses" element={<ActressesPage />} />
              <Route path="actresses/ranking" element={<ActressesPage />} />
              <Route path="actress/:slug" element={<ActressDetailPage />} />
              <Route path="genres" element={<GenresPage />} />
              <Route path="makers" element={<MakersPage />} />
              <Route path="categories" element={<CategoriesPage />} />
              {/* Nested MissAV catalog: /c/genres/中出  /c/makers/S1 */}
              <Route path="c/:kind/:name" element={<CategoriesPage />} />
              <Route path="c/:slug" element={<CategoriesPage />} />
              <Route path="v/:id" element={<WatchPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthShell>
    </LocaleProvider>
  )
}
