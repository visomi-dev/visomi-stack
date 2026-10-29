"""Documented commands must resolve in this repository's installed skill layout."""

import re
import unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parents[2]
REPO = SKILL.parents[2]
INVOCATION = re.compile(r'(?<![\w/.-])(?:python3?|node|bash)\s+"?([^\s"`\']+\.(?:py|cjs|js|mjs|sh))')


class SkillScriptPathsTest(unittest.TestCase):
    def test_documented_scripts_ship_in_the_repository(self):
        commands = []
        for document in [SKILL / 'SKILL.md', *(SKILL / 'references').glob('*.md')]:
            for match in INVOCATION.finditer(document.read_text(encoding='utf-8')):
                command = match.group(1)
                commands.append(command)
                with self.subTest(document=document.name, command=command):
                    target = (REPO / command).resolve()
                    self.assertTrue(target.is_relative_to(SKILL))
                    self.assertTrue(target.is_file(), f'Missing documented script: {command}')
        self.assertTrue(commands, 'No script invocations were checked')


if __name__ == '__main__':
    unittest.main()
