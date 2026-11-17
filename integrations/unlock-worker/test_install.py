import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

if sys.platform=='win32':sys.modules['pwd']=types.SimpleNamespace()
spec=importlib.util.spec_from_file_location('unlock_installer',Path(__file__).with_name('install.py'))
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)


class DiscoveryTests(unittest.TestCase):
    def test_auto_discovery_file_and_custom_agent_binary(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            def paths(value):
                original=Path(value)
                if original.is_relative_to(root):return original
                return root/str(value).lstrip('/\\')
            stored=paths('/opt/komari/auto-discovery.json');stored.parent.mkdir(parents=True)
            stored.write_text(json.dumps({'uuid':'node','token':'test-autodiscovered-token'}))
            proc=paths('/proc/100');proc.mkdir(parents=True)
            (proc/'cmdline').write_bytes(b'/opt/komari/agent\0-e\0https://monitor.example.com\0--auto-discovery\0not-a-node-token\0')
            (proc/'environ').write_bytes(b'')
            with patch.object(installer,'Path',paths):
                self.assertEqual(installer.discover_tokens(),{'test-autodiscovered-token'})

    def test_explicit_token_flag_in_agent_process(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            def paths(value):
                path=Path(value)
                return path if path.is_relative_to(root) else root/str(value).lstrip('/\\')
            proc=paths('/proc/100');proc.mkdir(parents=True)
            (proc/'cmdline').write_bytes(b'/usr/bin/komari-agent\0--token=test-explicit-token\0')
            (proc/'environ').write_bytes(b'')
            with patch.object(installer,'Path',paths):self.assertEqual(installer.discover_tokens(),{'test-explicit-token'})


if __name__=='__main__':unittest.main()
