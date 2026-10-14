import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Table } from './table';
import type { TableColumn } from './table-cell/table-cell';

type Row = { id: string; description: string; revision: string };

@Component({
  imports: [Table],
  template: '<app-table [data]="rows()" [columns]="columns" mobileCards stickyHeaders />',
})
class Host {
  readonly rows = signal<Row[]>([{ id: 'first', description: 'Encrypted record', revision: '00012' }]);

  readonly columns: TableColumn<Row>[] = [
    { key: 'description', label: 'Description' },
    { key: 'revision', label: 'Revision', class: 'text-right tabular-nums' },
  ];
}

describe('Table', () => {
  it('preserves native headers, mobile labels, exact text and dynamic rows', async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);

    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const cells = element.querySelectorAll('td');

    expect(element.querySelectorAll('th')).toHaveLength(2);
    expect(cells[1].textContent).toContain('00012');
    expect(cells[1].querySelector('strong')?.textContent?.trim()).toBe('Revision');
    expect(cells[1].classList.contains('text-right')).toBe(true);
    expect([...cells].every((cell) => cell.classList.contains('align-middle'))).toBe(true);
    fixture.componentInstance.rows.set([{ id: 'second', description: 'Replacement', revision: '00013' }]);
    await fixture.whenStable();
    expect(element.querySelector('tbody')?.textContent).toContain('00013');
    expect(element.querySelector('tbody')?.textContent).not.toContain('00012');
  });

  it('does not apply hover or sticky backgrounds unconditionally in dark mode', async () => {
    const fixture = TestBed.createComponent(Table);

    fixture.componentRef.setInput('stickyHeaders', true);
    await fixture.whenStable();
    expect(fixture.componentInstance.rowClasses()).toContain('dark:hover:bg-slate-800');
    expect(fixture.componentInstance.headerClasses({ key: 'id', label: 'ID' })).toContain('md:dark:bg-slate-800');
    fixture.componentRef.setInput('stickyHeaders', false);
    await fixture.whenStable();
    expect(fixture.componentInstance.headerClasses({ key: 'id', label: 'ID' })).not.toContain('bg-slate-800');
  });
});
