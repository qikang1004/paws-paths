import { Module } from '@nestjs/common';
import { InMemoryUserRepository, USER_REPOSITORY } from './user.repository';
import { UsersService } from './users.service';

@Module({
  providers: [UsersService, { provide: USER_REPOSITORY, useClass: InMemoryUserRepository }],
  exports: [UsersService],
})
export class UsersModule {}
