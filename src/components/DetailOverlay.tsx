import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { createDetailOverlay } from '../../integrations/detail-overlay/overlay-factory.mjs';
import '../../integrations/detail-overlay/detail-overlay.css';

const DetailOverlay = createDetailOverlay(React, React.createElement, useNavigate);
export default DetailOverlay;
