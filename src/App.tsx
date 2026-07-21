import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LocaleProvider } from './context'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { BrowsePage } from './pages/BrowsePage'
import { SearchPage } from './pages/SearchPage'
import { CategoriesPage } from './pages/CategoriesPage'
import { WatchPage } from './pages/WatchPage'
import { ActressesPage } from './pages/ActressesPage'
import { ActressDetailPage } from './pages/ActressDetailPage'

export default function App() {
  return (
    <LocaleProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="browse" element={<BrowsePage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="actresses" element={<ActressesPage />} />
            <Route path="actresses/ranking" element={<ActressesPage />} />
            <Route path="actress/:slug" element={<ActressDetailPage />} />
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="c/:slug" element={<CategoriesPage />} />
            <Route path="v/:id" element={<WatchPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </LocaleProvider>
  )
}
