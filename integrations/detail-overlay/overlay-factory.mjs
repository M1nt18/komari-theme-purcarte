// Uses the live app's React runtime so native context and routes stay intact.
export function createDetailOverlay(React, jsx, useNavigate) {
  return function DetailOverlay({ children }) {
    const navigate = useNavigate();
    const dialog = React.useRef(null);
    const pointer = React.useRef(null);
    const close = () => navigate('/', { replace: true });
    React.useEffect(() => {
      const element = dialog.current;
      const previousFocus = document.activeElement;
      if (element && !element.open) element.showModal();
      return () => {
        element?.close();
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
      };
    }, []);
    return jsx('dialog', {
      ref: dialog, className: 'detail-overlay', 'aria-label': '机器详情',
      onCancel: event => { event.preventDefault(); close(); },
      onPointerDown: event => {
        pointer.current = event.target === event.currentTarget
          ? { x: event.clientX, y: event.clientY } : null;
      },
      onClick: event => {
        const start = pointer.current;
        pointer.current = null;
        if (event.target === event.currentTarget && start
            && Math.hypot(event.clientX-start.x,event.clientY-start.y) < 6
            && !window.getSelection()?.toString().trim()) close();
      },
      onClickCapture: event => {
        // The original detail header's Back button now closes this window.
        const header = dialog.current?.querySelector('main > div > .theme-card-style');
        const back = header?.querySelector('button');
        if (back && event.target instanceof Element && back.contains(event.target)) {
          event.preventDefault(); event.stopPropagation(); close();
        }
      },
      children: jsx('div', { className: 'detail-overlay-shell', children: [
        jsx('div', { key: 'toolbar', className: 'detail-overlay-toolbar', children: [
          jsx('span', { key: 'title', children: '机器详情' }),
          jsx('button', { key: 'close', type: 'button', className: 'detail-overlay-close',
            'aria-label': '关闭机器详情', onClick: close, children: '×' }),
        ] }),
        jsx('div', { key: 'content', className: 'detail-overlay-content', children:
          jsx(React.Suspense, { fallback: jsx('div', { className: 'detail-overlay-loading', children: '正在读取详情…' }), children }),
        }),
      ] }),
    });
  };
}
