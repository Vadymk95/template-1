import type { FC } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const DevPlayground: FC = () => {
    return (
        <div className="container mx-auto max-w-4xl space-y-8 p-8">
            <div className="space-y-2">
                <h1 className="text-3xl font-bold">Dev UI Playground</h1>
                <p className="text-muted-foreground">
                    A dedicated space to visualize and test UI components in isolation during
                    development.
                </p>
            </div>

            <hr className="border-border" />

            {/* Buttons Section */}
            <section className="space-y-4">
                <h2 className="text-2xl font-semibold tracking-tight">Buttons</h2>
                <div className="grid gap-4 rounded-lg border p-6">
                    <div className="space-y-4">
                        <h3 className="text-sm font-medium text-muted-foreground">Variants</h3>
                        <div className="flex flex-wrap gap-4">
                            <Button variant="default">Default</Button>
                            <Button variant="secondary">Secondary</Button>
                            <Button variant="outline">Outline</Button>
                            <Button variant="ghost">Ghost</Button>
                            <Button variant="link">Link</Button>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-sm font-medium text-muted-foreground">Sizes</h3>
                        <div className="flex flex-wrap items-center gap-4">
                            <Button size="sm">Small</Button>
                            <Button size="default">Default</Button>
                            <Button size="lg">Large</Button>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-sm font-medium text-muted-foreground">States</h3>
                        <div className="flex flex-wrap items-center gap-4">
                            <Button disabled>Disabled</Button>
                            <Button variant="secondary" disabled>
                                Disabled Secondary
                            </Button>
                        </div>
                    </div>
                </div>
            </section>

            {/* Inputs Section */}
            <section className="space-y-4">
                <h2 className="text-2xl font-semibold tracking-tight">Inputs</h2>
                <div className="grid gap-4 rounded-lg border p-6">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <label
                                htmlFor="default-input"
                                className="text-sm font-medium leading-none"
                            >
                                Default Input
                            </label>
                            <Input id="default-input" placeholder="Email address" />
                        </div>
                        <div className="space-y-2">
                            <label
                                htmlFor="disabled-input"
                                className="text-sm font-medium leading-none"
                            >
                                Disabled Input
                            </label>
                            <Input id="disabled-input" disabled placeholder="Cannot type here" />
                        </div>
                        <div className="space-y-2">
                            <label
                                htmlFor="file-input"
                                className="text-sm font-medium leading-none"
                            >
                                File Input
                            </label>
                            <Input id="file-input" type="file" />
                        </div>
                        <div className="space-y-2">
                            <label
                                htmlFor="password-input"
                                className="text-sm font-medium leading-none"
                            >
                                Password Input
                            </label>
                            <Input id="password-input" type="password" placeholder="******" />
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};
