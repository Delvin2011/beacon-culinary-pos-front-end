import { AppSidebar } from "@/components/app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  //BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

import {TodayStats} from '../../components/dashboard/today-stats'
import {TopProducts} from '../../components/dashboard/top-products'
import {SalesTrends} from '../../components/dashboard/sales-trends'
import {TopCustomersHeatMap} from '../../components/dashboard/top-customers-heat-map'


export default function Page() {
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
                Building Your Application
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Dashboard</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <TodayStats />
          <div className="min-h-[100vh] grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 rounded-xl bg-muted/50 md:min-h-min">
            <div className="p-4">
              <TopProducts />
            </div>
            <div className="p-4">
              <SalesTrends />
            </div>
            <div className="p-4 col-span-1 md:col-span-2">
              <TopCustomersHeatMap />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

/*
          <div className="grid auto-rows-min gap-4 md:grid-cols-3">
            <div className="aspect-video rounded-xl bg-muted/50" />
            <div className="aspect-video rounded-xl bg-muted/50" />
            <div className="aspect-video rounded-xl bg-muted/50" />
          </div>
*/