import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class FindAllUsersDto {
  @IsOptional()
  @Min(1)
  @IsNumber()
  @Transform(({ value }) => Number.parseInt(value, 10))
  page!: number;

  @IsOptional()
  @IsNumber()
  @Max(100)
  @Transform(({ value }) => Number.parseInt(value, 10))
  limit!: number;
}
