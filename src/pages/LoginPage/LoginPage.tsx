import type { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RoutesPath } from '@/router/routes';
import { useUserStore } from '@/store/user/userStore';

import { useLoginForm } from './useLoginForm';

export const LoginPage: FunctionComponent = () => {
    const { t } = useTranslation(['auth', 'common']);
    const isLoggedIn = useUserStore.use.isLoggedIn();
    const { form, onSubmit } = useLoginForm();
    const {
        register,
        formState: { errors, isSubmitting }
    } = form;

    if (isLoggedIn) {
        return <Navigate to={RoutesPath.Root} replace />;
    }

    return (
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
            <div className="text-center">
                <h1 className="text-2xl font-bold">{t('auth:login.title')}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{t('auth:login.subtitle')}</p>
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
                <div className="flex flex-col gap-1.5">
                    <label htmlFor="email" className="text-sm font-medium">
                        {t('auth:login.email')}
                    </label>
                    <Input
                        id="email"
                        type="email"
                        placeholder={t('auth:login.emailPlaceholder')}
                        autoComplete="email"
                        aria-invalid={!!errors.email}
                        aria-describedby={errors.email ? 'email-error' : undefined}
                        {...register('email')}
                    />
                    {errors.email && (
                        <p id="email-error" className="text-sm text-destructive" role="alert">
                            {errors.email.message}
                        </p>
                    )}
                </div>

                <div className="flex flex-col gap-1.5">
                    <label htmlFor="password" className="text-sm font-medium">
                        {t('auth:login.password')}
                    </label>
                    <Input
                        id="password"
                        type="password"
                        placeholder={t('auth:login.passwordPlaceholder')}
                        autoComplete="current-password"
                        aria-invalid={!!errors.password}
                        aria-describedby={errors.password ? 'password-error' : undefined}
                        {...register('password')}
                    />
                    {errors.password && (
                        <p id="password-error" className="text-sm text-destructive" role="alert">
                            {errors.password.message}
                        </p>
                    )}
                </div>

                {errors.root && (
                    <p className="text-sm text-destructive" role="alert">
                        {errors.root.message}
                    </p>
                )}

                <Button type="submit" disabled={isSubmitting} className="w-full">
                    {isSubmitting ? t('auth:login.submitting') : t('auth:login.submit')}
                </Button>
            </form>
        </div>
    );
};
