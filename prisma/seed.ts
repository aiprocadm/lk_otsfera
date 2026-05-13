import { prisma } from '../src/lib/db/prisma';
import bcrypt from 'bcryptjs';
async function main(){
 const company = await prisma.company.upsert({where:{id:'demo-company'}, update:{}, create:{id:'demo-company',name:'Demo LLC'}});
 const passwordHash = await bcrypt.hash('Password123!',10);
 await prisma.user.upsert({where:{email:'admin@demo.local'},update:{},create:{email:'admin@demo.local',name:'Admin',passwordHash,companyId:company.id,role:'admin'}});
}
main().finally(()=>prisma.$disconnect());
