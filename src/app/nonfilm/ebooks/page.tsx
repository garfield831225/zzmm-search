import NonFilmList from '@/components/NonFilmList';

export default function EbooksPage() {
  return (
    <NonFilmList
      category="电子书"
      title="电子书"
      icon="📚"
      description="小说 / 教程 / 工具书（VIP）"
      accentColor="from-blue-500 to-cyan-600"
    />
  );
}
