import { zodResolver } from '@hookform/resolvers/zod';
import type { BaseSyntheticEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { authApi } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { logger } from '@/lib/logger';
import { RoutesPath } from '@/router/routes';
import { useUserStore } from '@/store/user/userStore';

// Schema defined at module level — stable reference, zodResolver reads it once.
// Error messages are intentionally English here.
// To wire zod to i18n globally, set a custom z.setErrorMap() in your app entry.
// z.email() is the Zod v4 way — replaces the deprecated z.string().email()
const loginSchema = z.object({
    email: z.string().min(1, 'Email is required').pipe(z.email('Enter a valid email address')),
    password: z.string().min(1, 'Password is required').min(8, 'At least 8 characters')
});

export type LoginFormData = z.infer<typeof loginSchema>;

export const useLoginForm = () => {
    const { t } = useTranslation(['auth', 'errors']);
    const navigate = useNavigate();
    const setUser = useUserStore.use.setUser();

    const form = useForm<LoginFormData>({
        resolver: zodResolver(loginSchema),
        defaultValues: { email: '', password: '' }
    });

    const submitHandler = form.handleSubmit(async (data) => {
        try {
            const response = await authApi.login(data);
            setUser(response.username, response.token);
            void navigate(RoutesPath.Root);
        } catch (error) {
            logger.warn('Login failed', { error: String(error) });
            const message =
                error instanceof ApiError && error.status === 401
                    ? t('auth:login.error.invalidCredentials')
                    : t('errors:api.unknown');
            form.setError('root', { message });
        }
    });

    // Wrap to satisfy onSubmit: void (form.handleSubmit returns Promise<void>)
    const onSubmit = (e?: BaseSyntheticEvent): void => {
        void submitHandler(e);
    };

    return { form, onSubmit };
};
