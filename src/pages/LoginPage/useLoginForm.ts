import { zodResolver } from '@hookform/resolvers/zod';
import type { BaseSyntheticEvent } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { authApi } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/client';
import { logger } from '@/lib/logger';
import { RoutesPath } from '@/router/routes';
import { useUserStore } from '@/store/user/userStore';

// Interpolated into the message too, so the rule and the text it advertises
// cannot drift apart.
const PASSWORD_MIN_LENGTH = 8;

const HTTP_UNAUTHORIZED = 401;

// Schema defined at module level — stable reference, zodResolver reads it once.
// Error messages are intentionally English here.
// To wire zod to i18n globally, set a custom z.setErrorMap() in your app entry.
// z.email() is the Zod v4 way — replaces the deprecated z.string().email()
const loginSchema = z.object({
    email: z.string().min(1, 'Email is required').pipe(z.email('Enter a valid email address')),
    password: z
        .string()
        .min(1, 'Password is required')
        .min(PASSWORD_MIN_LENGTH, `At least ${String(PASSWORD_MIN_LENGTH)} characters`)
});

export type LoginFormData = z.infer<typeof loginSchema>;

export const useLoginForm = (): {
    form: UseFormReturn<LoginFormData>;
    onSubmit: (e?: BaseSyntheticEvent) => void;
} => {
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
                error instanceof ApiError && error.status === HTTP_UNAUTHORIZED
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
