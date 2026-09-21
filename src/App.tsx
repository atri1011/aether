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
import { FramesPage } from './pages/FramesPage'
import { FrameDetailPage } from './pages/FrameDetailPage'
import { TopicsPage } from './pages/TopicsPage'
import { TopicDetailPage } from './pages/TopicDetailPage'
import { WhosRankingPage } from './pages/WhosRankingPage'
import { DramaAiRoute, DramaTagRoute, DramaVideoRoute } from './pages/DramaListPage'
import { DramaTagsPage } from './pages/DramaTagsPage'

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
              {/* whos.tv: frames / topics / ranking */}
              <Route path="frames" element={<FramesPage />} />
              <Route path="frames/:id" element={<FrameDetailPage />} />
              <Route path="topics" element={<TopicsPage />} />
              <Route path="topics/:id" element={<TopicDetailPage />} />
              <Route path="ranking" element={<WhosRankingPage />} />
              {/* 黄果短剧: AI 站分类 / 标签索引 / 剧场分类 */}
              <Route path="drama" element={<Navigate to="/drama/ai/ai-duanju" replace />} />
              <Route path="drama/ai/:slug" element={<DramaAiRoute />} />
              <Route path="drama/tags" element={<DramaTagsPage />} />
              <Route path="drama/tag/:slug" element={<DramaTagRoute />} />
              <Route path="drama/video/:category" element={<DramaVideoRoute />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthShell>
    </LocaleProvider>
  )
}
