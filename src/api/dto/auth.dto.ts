export class AuthRegisterDto {
  email: string;
  password: string;
  name?: string;
}

export class AuthLoginDto {
  email: string;
  password: string;
}
