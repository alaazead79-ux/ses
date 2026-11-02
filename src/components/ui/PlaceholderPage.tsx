import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import PageHeader from './PageHeader';
import EmptyState from './EmptyState';

interface PlaceholderPageProps {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  description: string;
  action?: ReactNode;
}

/** صفحة وحدة بحالة فارغة — تُستخدم في المرحلة الأولى قبل ربط المنطق */
export default function PlaceholderPage({
  title,
  subtitle,
  icon,
  description,
  action,
}: PlaceholderPageProps) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} icon={icon} actions={action} />
      <div className="card">
        <EmptyState
          icon={icon}
          title="لا توجد بيانات بعد"
          description={description}
          action={
            <button className="btn-primary" disabled>
              ستبدأ هذه الوظيفة اعتبارًا من المرحلة التالية
            </button>
          }
        />
      </div>
    </div>
  );
}
