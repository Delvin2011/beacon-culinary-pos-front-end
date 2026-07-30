"use client"

import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
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

import { MoreHorizontal } from 'lucide-react'; // For 3 dots icon

interface Role {
  id: string
  name: string
  description: string
  isActive: boolean
  permissions: string[]
}

const PREDEFINED_PERMISSIONS = [
  "Customer Portal Access",
  "Live Chat Access",
  "User Creation",
  "Activity Tracking",
  "Generate Reports"
]

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [newRole, setNewRole] = useState<Omit<Role, 'id'>>({
    name: '',
    description: '',
    isActive: true,
    permissions: []
  })

  const [isCreateRoleDialogOpen, setCreateRoleDialogOpen] = useState(false);

  const [isDialogOpen, setDialogOpen] = useState(false);
const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
const [actionType, setActionType] = useState<'delete' | 'activate' | 'deactivate' | null>(null);

const confirmAction = (roleId: string, action: 'delete' | 'activate' | 'deactivate') => {
  setSelectedRoleId(roleId);
  setActionType(action);
  setDialogOpen(true);
};
const handleConfirm = () => {
  if (selectedRoleId && actionType) {
    if (actionType === 'delete') {
      handleDeleteRole(selectedRoleId); // Delete role
    } else {
      const updatedRoles = roles.map(role =>
        role.id === selectedRoleId
          ? { ...role, isActive: actionType === 'activate' }
          : role
      );
      setRoles(updatedRoles); // Activate/Deactivate role
    }
  }
  setDialogOpen(false);
  setSelectedRoleId(null);
  setActionType(null);
};


  const handleCreateRole = () => {
    if (!newRole.name) {
      toast({
        title: "Error",
        description: "Role name is required",
        variant: "destructive",
      })
      return
    }
    const role: Role = {
      ...newRole,
      id: Date.now().toString()
    }
    setRoles([...roles, role])
    setNewRole({
      name: '',
      description: '',
      isActive: true,
      permissions: []
    })
    toast({
      title: "Success",
      description: "Role created successfully",
    })

    setCreateRoleDialogOpen(false);
  }

  const handleDeleteRole = (id: string) => {
    setRoles(roles.filter(role => role.id !== id))
    toast({
      title: "Success",
      description: "Role deleted successfully",
    })
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
                <BreadcrumbPage>Roles</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <footer className="pl-4">
      <div>
      <h2 className="text-xl font-semibold mb-4 items-center" >Roles Management</h2>
      <Dialog open={isCreateRoleDialogOpen} onOpenChange={setCreateRoleDialogOpen}>
        <DialogTrigger asChild>
          <Button>Create New Role</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Role</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Name
              </Label>
              <Input
                id="name"
                value={newRole.name}
                onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="description" className="text-right">
                Description
              </Label>
              <Input
                id="description"
                value={newRole.description}
                onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="isActive" className="text-right">
                Active
              </Label>
              <Checkbox
                id="isActive"
                checked={newRole.isActive}
                onCheckedChange={(checked) => setNewRole({ ...newRole, isActive: checked as boolean })}
              />
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <Label className="text-right">Permissions</Label>
              <div className="col-span-3 space-y-2">
                {PREDEFINED_PERMISSIONS.map((permission) => (
                  <div key={permission} className="flex items-center space-x-2">
                    <Checkbox
                      id={permission}
                      checked={newRole.permissions.includes(permission)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setNewRole({ ...newRole, permissions: [...newRole.permissions, permission] })
                        } else {
                          setNewRole({ ...newRole, permissions: newRole.permissions.filter(p => p !== permission) })
                        }
                      }}
                    />
                    <Label htmlFor={permission}>{permission}</Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <Button onClick={handleCreateRole}>Create Role</Button>
        </DialogContent>
      </Dialog>

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

      <Table className="mt-4">
        <TableHeader>
          <TableRow>
            <TableHead>Role Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Active Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
  {roles.map((role) => (
    <TableRow key={role.id}>
      <TableCell>{role.name}</TableCell>
      <TableCell>{role.description}</TableCell>
      <TableCell>{role.isActive ? 'Active' : 'Inactive'}</TableCell>
      <TableCell className="relative">
        <Button
          variant="outline"
          onClick={() => {
            // Toggle the visibility of the dropdown
            const menu = document.getElementById(`menu-${role.id}`);
            if (menu) {
              menu.classList.toggle('hidden');
            }
          }}
        >
          <MoreHorizontal />
        </Button>

        {/* Context Menu for Actions */}
        <div
          id={`menu-${role.id}`}
          className="hidden absolute top-full right-0 mt-2 w-40 bg-white border rounded shadow-lg z-50"
        >
          <Button
            variant="link"
            onClick={() => {
              confirmAction(role.id, role.isActive ? 'deactivate' : 'activate');
            }}
          >
            {role.isActive ? 'Deactivate' : 'Activate'}
          </Button>
          <Button
            variant="link"
            onClick={() => {
              confirmAction(role.id, 'delete');
            }}
          >
            Delete
          </Button>
        </div>
      </TableCell>
    </TableRow>
  ))}
</TableBody>


      </Table>
    </div>
      </footer>

    </SidebarInset>
  </SidebarProvider>

  )
}

