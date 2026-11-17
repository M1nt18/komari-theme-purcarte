import type * as React from 'react';
import type { useNavigate } from 'react-router-dom';
export function createDetailOverlay(runtime: typeof React, render: typeof React.createElement, navigateHook: typeof useNavigate): React.ComponentType<React.PropsWithChildren>;
