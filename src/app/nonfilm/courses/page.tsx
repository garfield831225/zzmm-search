import NonFilmList from '@/components/NonFilmList';

export default function CoursesPage() {
  return (
    <NonFilmList
      category="精品课"
      title="精品课"
      icon="🎓"
      description="付费课 / 讲座（VIP）"
      accentColor="from-violet-500 to-purple-600"
    />
  );
}
