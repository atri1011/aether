/**
 * MissAV-style primary navigation (login / VIP / ads / collections omitted).
 * Paths map to in-app routes; list entries use /c/:slug (server categories).
 */

export type NavIconName =
  | 'home'
  | 'browse'
  | 'subtitle'
  | 'jav'
  | 'actresses'
  | 'ranking'
  | 'genres'
  | 'makers'
  | 'hot'
  | 'amateur'
  | 'uncensored'
  | 'asia'
  | 'vr'
  | 'list'

export type NavLeaf = {
  id: string
  titleZh: string
  titleEn: string
  to: string
  icon?: NavIconName
  /** Match ranking / nested paths */
  end?: boolean
}

export type NavGroup = {
  id: string
  titleZh: string
  titleEn: string
  icon?: NavIconName
  children: NavLeaf[]
  /** Open by default on first render */
  defaultOpen?: boolean
}

export type NavEntry =
  | ({ type: 'link' } & NavLeaf)
  | ({ type: 'group' } & NavGroup)

export const NAV: NavEntry[] = [
  {
    type: 'link',
    id: 'home',
    titleZh: '首页',
    titleEn: 'Home',
    to: '/',
    icon: 'home',
    end: true,
  },
  {
    type: 'link',
    id: 'browse',
    titleZh: '浏览',
    titleEn: 'Browse',
    to: '/browse',
    icon: 'browse',
  },
  {
    type: 'link',
    id: 'chinese-subtitle',
    titleZh: '中文字幕',
    titleEn: 'Chinese subtitle',
    to: '/c/chinese-subtitle',
    icon: 'subtitle',
  },
  {
    type: 'link',
    id: 'english-subtitle',
    titleZh: '英文字幕',
    titleEn: 'English subtitle',
    to: '/c/english-subtitle',
    icon: 'subtitle',
  },
  {
    type: 'group',
    id: 'watch-jav',
    titleZh: '观看 JAV',
    titleEn: 'Watch JAV',
    icon: 'jav',
    defaultOpen: true,
    children: [
      {
        id: 'new',
        titleZh: '最近更新',
        titleEn: 'Recent update',
        to: '/c/new',
        icon: 'list',
      },
      {
        id: 'release',
        titleZh: '新作上市',
        titleEn: 'New Releases',
        to: '/c/release',
        icon: 'list',
      },
      {
        id: 'uncensored-leak',
        titleZh: '无码流出',
        titleEn: 'Uncensored leak',
        to: '/c/uncensored-leak',
        icon: 'uncensored',
      },
      {
        id: 'actresses',
        titleZh: '女优一览',
        titleEn: 'Actress list',
        to: '/actresses',
        icon: 'actresses',
        end: true,
      },
      {
        id: 'actresses-ranking',
        titleZh: '女优排行',
        titleEn: 'Actress ranking',
        to: '/actresses/ranking',
        icon: 'ranking',
      },
      {
        id: 'genres',
        titleZh: '类型',
        titleEn: 'Genre',
        to: '/genres',
        icon: 'genres',
      },
      {
        id: 'makers',
        titleZh: '发行商',
        titleEn: 'Maker',
        to: '/makers',
        icon: 'makers',
      },
      {
        id: 'vr',
        titleZh: 'VR',
        titleEn: 'VR',
        to: '/c/vr',
        icon: 'vr',
      },
      {
        id: 'today-hot',
        titleZh: '今日热门',
        titleEn: 'Most viewed today',
        to: '/c/today-hot',
        icon: 'hot',
      },
      {
        id: 'weekly-hot',
        titleZh: '本周热门',
        titleEn: 'Most viewed by week',
        to: '/c/weekly-hot',
        icon: 'hot',
      },
      {
        id: 'monthly-hot',
        titleZh: '本月热门',
        titleEn: 'Most viewed by month',
        to: '/c/monthly-hot',
        icon: 'hot',
      },
    ],
  },
  {
    type: 'group',
    id: 'amateur',
    titleZh: '素人',
    titleEn: 'Amateur',
    icon: 'amateur',
    children: [
      { id: 'siro', titleZh: 'SIRO', titleEn: 'SIRO', to: '/c/siro' },
      { id: 'luxu', titleZh: 'LUXU', titleEn: 'LUXU', to: '/c/luxu' },
      { id: 'gana', titleZh: 'GANA', titleEn: 'GANA', to: '/c/gana' },
      {
        id: 'maan',
        titleZh: 'PRESTIGE PREMIUM',
        titleEn: 'PRESTIGE PREMIUM',
        to: '/c/maan',
      },
      { id: 'scute', titleZh: 'S-CUTE', titleEn: 'S-CUTE', to: '/c/scute' },
      { id: 'ara', titleZh: 'ARA', titleEn: 'ARA', to: '/c/ara' },
    ],
  },
  {
    type: 'group',
    id: 'uncensored',
    titleZh: '无码影片',
    titleEn: 'Uncensored',
    icon: 'uncensored',
    children: [
      {
        id: 'uncensored-leak-2',
        titleZh: '无码流出',
        titleEn: 'Uncensored leak',
        to: '/c/uncensored-leak',
      },
      { id: 'fc2', titleZh: 'FC2', titleEn: 'FC2', to: '/c/fc2' },
      { id: 'heyzo', titleZh: 'HEYZO', titleEn: 'HEYZO', to: '/c/heyzo' },
      {
        id: 'tokyohot',
        titleZh: '东京热',
        titleEn: 'Tokyo Hot',
        to: '/c/tokyohot',
      },
      { id: '1pondo', titleZh: '一本道', titleEn: '1pondo', to: '/c/1pondo' },
      {
        id: 'caribbeancom',
        titleZh: 'Caribbeancom',
        titleEn: 'Caribbeancom',
        to: '/c/caribbeancom',
      },
      {
        id: 'caribbeancompr',
        titleZh: 'Caribbeancompr',
        titleEn: 'Caribbeancompr',
        to: '/c/caribbeancompr',
      },
      {
        id: '10musume',
        titleZh: '10musume',
        titleEn: '10musume',
        to: '/c/10musume',
      },
      {
        id: 'pacopacomama',
        titleZh: 'pacopacomama',
        titleEn: 'pacopacomama',
        to: '/c/pacopacomama',
      },
      {
        id: 'gachinco',
        titleZh: 'Gachinco',
        titleEn: 'Gachinco',
        to: '/c/gachinco',
      },
      { id: 'xxxav', titleZh: 'XXX-AV', titleEn: 'XXX-AV', to: '/c/xxxav' },
      {
        id: 'marriedslash',
        titleZh: '人妻斩',
        titleEn: 'Married Slash',
        to: '/c/marriedslash',
      },
      {
        id: 'naughty4610',
        titleZh: '顽皮 4610',
        titleEn: 'Naughty 4610',
        to: '/c/naughty4610',
      },
      {
        id: 'naughty0930',
        titleZh: '顽皮 0930',
        titleEn: 'Naughty 0930',
        to: '/c/naughty0930',
      },
    ],
  },
  {
    type: 'group',
    id: 'asia-av',
    titleZh: '亚洲 AV',
    titleEn: 'Asia AV',
    icon: 'asia',
    children: [
      { id: 'madou', titleZh: '麻豆传媒', titleEn: 'Madou', to: '/c/madou' },
      { id: 'twav', titleZh: 'TWAV', titleEn: 'TWAV', to: '/c/twav' },
      { id: 'furuke', titleZh: 'Furuke', titleEn: 'Furuke', to: '/c/furuke' },
      {
        id: 'klive',
        titleZh: '韩国直播',
        titleEn: 'Korean Live',
        to: '/c/klive',
      },
      {
        id: 'clive',
        titleZh: '中国直播',
        titleEn: 'Chinese Live',
        to: '/c/clive',
      },
    ],
  },
  {
    type: 'link',
    id: 'categories',
    titleZh: '全部分类',
    titleEn: 'All categories',
    to: '/categories',
    icon: 'genres',
  },
]

export function navTitle(entry: { titleZh: string; titleEn: string }, locale: string) {
  return locale === 'en' ? entry.titleEn : entry.titleZh
}
