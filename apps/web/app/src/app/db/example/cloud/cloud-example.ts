import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { NavigationHeading } from '../../../shared/navigation-heading';
import {
  Alert,
  Badge,
  Button,
  Card,
  DescriptionList,
  Field,
  Fieldset,
  Heading,
  Input,
  Label,
  LinkButton,
  Radio,
  RadioCard,
  Text,
  Textarea,
} from '../../../ui';

import { CloudWorkspace } from './cloud-workspace';

@Component({
  selector: 'app-cloud-example',
  imports: [
    Alert,
    Badge,
    Button,
    Card,
    DatePipe,
    DescriptionList,
    Field,
    Fieldset,
    Heading,
    Input,
    Label,
    LinkButton,
    NavigationHeading,
    NgTemplateOutlet,
    Radio,
    RadioCard,
    RouterLink,
    Text,
    Textarea,
  ],
  providers: [CloudWorkspace],
  templateUrl: './cloud-example.html',
})
export class CloudExample {
  private readonly noteTitle = viewChild<ElementRef<HTMLInputElement>>('noteTitle');

  protected readonly workspace = inject(CloudWorkspace);

  protected focusNoteTitle(): void {
    this.noteTitle()?.nativeElement.focus();
  }

  protected async saveNote(form: HTMLFormElement): Promise<void> {
    const saved = await this.workspace.save();

    if (saved) {
      form.reset();
    }
  }
}
