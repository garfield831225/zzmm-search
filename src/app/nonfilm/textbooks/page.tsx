import NonFilmList from '@/components/NonFilmList';

export default function TextbooksPage() {
  return (
    <NonFilmList
      category="文档"
      title="教辅"
      description="教程 / 工具 / 课件（VIP）"
      icon="📖"
      accentColor="from-slate-500 to-gray-600"
    />
  );
}
