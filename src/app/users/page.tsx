"use client"

import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "@/hooks/use-toast"
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbSeparator, BreadcrumbPage } from '@/components/ui/breadcrumb'
import { Separator } from '@radix-ui/react-separator'

interface User {
  id: string
  username: string
  description: string
  role: string
  categories: string[]
  latestActivity: string
  password: string
  confirmPassword: string
  email: string
  status: string
}

const CATEGORIES = [
  "Retailer",
  "Bulk Buyer",
  "Corporate Client",
  "Small Business",
  "Independent Seller",
  "General Customer"
]

const ROLES = ["Admin", "Manager", "User"]

const initialUsers: User[] = [
  {
    id: '1',
    username: 'johndoe',
    description: 'Regular user',
    role: 'Admin',
    categories: ['Retailer'],
    latestActivity: 'Logged In',
    password: 'password123',
    confirmPassword: 'password123',
    email: 'johndoe@example.com',
    status: 'Active'
  },
  {
    id: '2',
    username: 'janedoe',
    description: 'Manager',
    role: 'Manager',
    categories: ['Small Business'],
    latestActivity: 'Placed an order',
    password: 'password123',
    confirmPassword: 'password123',
    email: 'janedoe@example.com',
    status: 'De-activated'
  }
]

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>(initialUsers)
  const [newUser, setNewUser] = useState<Omit<User, 'id' | 'latestActivity' | 'status'>>({
    username: '',
    description: '',
    role: '',
    categories: [],
    password: '',
    confirmPassword: '',
    email: ''
  })

  const handleCreateUser = () => {
    if (!newUser.username || !newUser.role) {
      toast({
        title: "Error",
        description: "Username and role are required",
        variant: "destructive",
      })
      return
    }
    const user: User = {
      ...newUser,
      id: Date.now().toString(),
      latestActivity: 'Logged In',
      status: 'Active'
    }
    setUsers([...users, user])
    setNewUser({
      username: '',
      description: '',
      role: '',
      categories: [],
      password: '',
      confirmPassword: '',
      email: '',
    })
    toast({
      title: "Success",
      description: "User created successfully",
    })
  }

  const [isDialogOpen, setDialogOpen] = useState(false);
  const [actionType, setActionType] = useState<'delete' | 'activate' | 'deactivate' | null>(null);
const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  

  const handleDeleteUser = (id: string) => {
    setActionType('delete');
    setDialogOpen(true);
    setSelectedUserId(id);

   /* if (window.confirm("Are you sure you want to delete this user?")) {
      setUsers(users.filter(user => user.id !== id))
      toast({
        title: "Success",
        description: "User deleted successfully",
      })
    }*/
  }

  const handleConfirm = () => {
    if (selectedUserId && actionType) {
      if (actionType === 'delete') {
        handleActionDeletion(selectedUserId); // Delete role
      } 
    }
    setDialogOpen(false);
    setSelectedUserId(null);
    setActionType(null);
  };

  const handleActionDeletion = (id: string) => {
    setUsers(users.filter(user => user.id !== id))
    toast({
      title: "Success",
      description: "Role deleted successfully",
    })
  }


  const handleToggleUserStatus = (id: string) => {
    const user = users.find((user) => user.id === id)
    if (user) {
      const newStatus = user.status === 'Active' ? 'De-activated' : 'Active'
      if (window.confirm(`Are you sure you want to ${newStatus === 'Active' ? 'activate' : 'deactivate'} this user?`)) {
        setUsers(
          users.map((user) =>
            user.id === id ? { ...user, status: newStatus } : user
          )
        )
        toast({
          title: "Success",
          description: `User ${newStatus === 'Active' ? 'activated' : 'deactivated'} successfully`,
        })
      }
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  Onboarding
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Users</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <footer className="pl-4">
          <div>
            <h2 className="text-xl font-semibold mb-4">Users Management</h2>
            <Dialog>
  <DialogTrigger asChild>
    <Button>Create New User</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Create New User</DialogTitle>
    </DialogHeader>
    <div className="py-4">
      <div className="mb-4">
        <Label htmlFor="username" className="block text-sm font-medium text-gray-700">
          Username
        </Label>
        <Input
          id="username"
          value={newUser.username}
          onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
          className="mt-1 block w-full"
        />
      </div>
      
      <div className="mb-4">
        <Label htmlFor="description" className="block text-sm font-medium text-gray-700">
          Description
        </Label>
        <Input
          id="description"
          value={newUser.description}
          onChange={(e) => setNewUser({ ...newUser, description: e.target.value })}
          className="mt-1 block w-full"
        />
      </div>
      
      <div className="mb-4">
        <Label htmlFor="email" className="block text-sm font-medium text-gray-700">
          Email Address
        </Label>
        <Input
          id="email"
          type="email"
          value={newUser.email}
          onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
          className="mt-1 block w-full"
          required
        />
      </div>

      <div className="mb-4">
        <Label htmlFor="password" className="block text-sm font-medium text-gray-700">
          Password
        </Label>
        <Input
          id="password"
          type="password"
          value={newUser.password}
          onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
          className="mt-1 block w-full"
          required
          minLength={8}
          placeholder="Password must be at least 8 characters"
        />
      </div>

      <div className="mb-4">
        <Label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
          Confirm Password
        </Label>
        <Input
          id="confirmPassword"
          type="password"
          value={newUser.confirmPassword}
          onChange={(e) => setNewUser({ ...newUser, confirmPassword: e.target.value })}
          className="mt-1 block w-full"
          required
          minLength={8}
          placeholder="Re-enter your password"
        />
      </div>

      <div className="mb-4">
        <Label htmlFor="role" className="block text-sm font-medium text-gray-700">
          Role
        </Label>
        <Select
          onValueChange={(value) => setNewUser({ ...newUser, role: value })}
        >
          <SelectTrigger className="mt-1 block w-full flex items-center justify-between pr-4">
            <SelectValue placeholder="Select a role" />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((role) => (
              <SelectItem key={role} value={role}>{role}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mb-4">
        <Label htmlFor="categories" className="block text-sm font-medium text-gray-700">
          Categories
        </Label>
        <Select
          onValueChange={(value) => setNewUser({ ...newUser, categories: [...newUser.categories, value] })}
        >
          <SelectTrigger className="mt-1 block w-full flex items-center justify-between pr-4">
            <SelectValue placeholder="Select categories" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>{category}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mb-4">
        <div className="flex flex-wrap gap-2">
          {newUser.categories.map((category) => (
            <span
              key={category}
              className="inline-block bg-gray-200 rounded-full px-3 py-1 text-sm font-semibold text-gray-700"
            >
              {category}
            </span>
          ))}
        </div>
      </div>
      
      <Button onClick={handleCreateUser}>Create User</Button>
    </div>
  </DialogContent>
</Dialog>

            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Latest Activity</TableHead>
                  <TableHead>Assigned Role</TableHead>
                  <TableHead>Assigned Categories</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.username}</TableCell>
                    <TableCell>{user.description}</TableCell>
                    <TableCell>{user.latestActivity}</TableCell>
                    <TableCell>{user.role}</TableCell>
                    <TableCell>{user.categories.join(', ')}</TableCell>
                    <TableCell>{user.status}</TableCell>
                    <TableCell>
                      <Button
                        variant={user.status === 'Active' ? 'destructive' : 'outline'}
                        onClick={() => handleToggleUserStatus(user.id)}
                        className="mr-2"
                      >
                        {user.status === 'Active' ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => handleDeleteUser(user.id)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionType === 'delete' ? 'Delete Role' : actionType === 'activate' ? 'Activate Role' : 'Deactivate Role'}</DialogTitle>
          </DialogHeader>
          <div>
            <p>
              {actionType === 'delete'
                ? 'Are you sure you want to delete this role? This action cannot be undone.'
                : actionType === 'activate'
                ? 'Are you sure you want to activate this role?'
                : 'Are you sure you want to deactivate this role?'}
            </p>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm}>
              Confirm
            </Button>
          </div>
        </DialogContent>
    </Dialog>
          </div>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  )
}
