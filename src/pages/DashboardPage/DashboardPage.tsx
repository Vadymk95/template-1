import type { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { RoutesPath } from '@/router/routes';
import { useUserStore } from '@/store/user/userStore';

export const DashboardPage: FunctionComponent = () => {
    const { t } = useTranslation('auth');
    const navigate = useNavigate();
    const username = useUserStore.use.username();
    const logout = useUserStore.use.logout();

    const handleLogout = () => {
        logout();
        void navigate(RoutesPath.Login);
    };

    return (
        <div className="flex flex-col items-center gap-6">
            <header className="text-center">
                <h1 className="mb-2 text-3xl font-bold">{t('dashboard.title')}</h1>
                <p className="text-muted-foreground">
                    {t('dashboard.welcome', { username: username ?? 'User' })}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.description')}</p>
            </header>
            <Button variant="outline" onClick={handleLogout}>
                {t('dashboard.logout')}
            </Button>
        </div>
    );
};
